import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  WritableSignal,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { XliffService } from './xliff.service';
import { XliffFile, XliffUnit } from './xliff.models';

interface Row {
  readonly unit: XliffUnit;
  readonly target: WritableSignal<string>;
  readonly state: WritableSignal<string>;
  readonly savedTarget: WritableSignal<string>;
  readonly savedState: WritableSignal<string>;
  readonly translating: WritableSignal<boolean>;
  readonly dirty: () => boolean;
}

const UNTRANSLATED_STATES = ['', 'new', 'needs-translation'];

@Component({
  selector: 'app-root',
  imports: [],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly api = inject(XliffService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly toolbar = viewChild<ElementRef<HTMLElement>>('toolbar');

  protected readonly file = signal<XliffFile | null>(null);
  protected readonly rows = signal<Row[]>([]);
  protected readonly states = signal<string[]>([]);

  protected readonly search = signal('');
  protected readonly stateFilter = signal('all');
  protected readonly busy = signal<string>('');
  protected readonly error = signal('');
  protected readonly notice = signal('');

  protected readonly dirtyRows = computed(() => this.rows().filter((row) => row.dirty()));
  protected readonly untranslatedRows = computed(() =>
    this.rows().filter((row) => UNTRANSLATED_STATES.includes(row.state()))
  );

  protected readonly visibleRows = computed(() => {
    const term = this.search().trim().toLowerCase();
    const state = this.stateFilter();
    return this.rows().filter((row) => {
      if (state === 'untranslated' && !UNTRANSLATED_STATES.includes(row.state())) return false;
      if (state !== 'all' && state !== 'untranslated' && row.state() !== state) return false;
      if (!term) return true;
      return (
        row.unit.id.toLowerCase().includes(term) ||
        row.unit.source.toLowerCase().includes(term) ||
        row.target().toLowerCase().includes(term)
      );
    });
  });

  constructor() {
    this.api.states().subscribe({
      next: ({ states }) => this.states.set(states),
      error: () => this.states.set(['new', 'translated', 'final']),
    });
    this.trackToolbarHeight();
  }

  /**
   * The toolbar is sticky and its height changes as the controls wrap, so the
   * measured height is published as a CSS variable that the sticky table
   * header offsets itself by.
   */
  private trackToolbarHeight(): void {
    effect((onCleanup) => {
      const toolbar = this.toolbar()?.nativeElement;
      if (!toolbar || typeof ResizeObserver === 'undefined') return;

      const observer = new ResizeObserver(() =>
        this.host.nativeElement.style.setProperty(
          '--toolbar-height',
          `${toolbar.offsetHeight}px`
        )
      );
      observer.observe(toolbar);
      onCleanup(() => observer.disconnect());
    });
  }

  protected downloadUrl(): string {
    const file = this.file();
    return file ? this.api.downloadUrl(file.id) : '';
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.reset();
    this.busy.set('Uploading…');
    this.api.upload(file).subscribe({
      next: (uploaded) => {
        this.setFile(uploaded);
        this.notice.set(`Loaded ${uploaded.units.length} keys from ${uploaded.originalName}.`);
        this.busy.set('');
        input.value = '';
      },
      error: (err) => this.fail(err, () => (input.value = '')),
    });
  }

  protected translateRow(row: Row): void {
    const file = this.file();
    if (!file) return;
    this.error.set('');
    row.translating.set(true);
    this.api.translate(file.id, [row.unit.id]).subscribe({
      next: ({ translations }) => {
        row.translating.set(false);
        this.applyTranslations(translations);
      },
      error: (err) => {
        row.translating.set(false);
        this.fail(err);
      },
    });
  }

  protected translateUntranslated(): void {
    const file = this.file();
    const pending = this.untranslatedRows();
    if (!file || pending.length === 0) return;

    this.error.set('');
    this.busy.set(`Translating ${pending.length} keys…`);
    pending.forEach((row) => row.translating.set(true));
    this.api.translate(file.id, pending.map((row) => row.unit.id)).subscribe({
      next: ({ translations }) => {
        pending.forEach((row) => row.translating.set(false));
        this.busy.set('');
        this.applyTranslations(translations);
      },
      error: (err) => {
        pending.forEach((row) => row.translating.set(false));
        this.fail(err);
      },
    });
  }

  protected save(): void {
    const file = this.file();
    const dirty = this.dirtyRows();
    if (!file || dirty.length === 0) return;

    this.error.set('');
    this.busy.set('Saving…');
    const payload = dirty.map((row) => ({
      id: row.unit.id,
      target: row.target(),
      state: row.state(),
    }));
    this.api.save(file.id, payload).subscribe({
      next: (saved) => {
        dirty.forEach((row) => {
          row.savedTarget.set(row.target());
          row.savedState.set(row.state());
        });
        this.file.set(saved);
        this.busy.set('');
        this.notice.set(`Saved ${saved.saved} keys to ${saved.originalName}.`);
      },
      error: (err) => this.fail(err),
    });
  }

  protected copySource(row: Row): void {
    row.target.set(row.unit.source);
  }

  protected markVisibleTranslated(): void {
    this.visibleRows()
      .filter((row) => row.target().trim() && row.state() !== 'translated')
      .forEach((row) => row.state.set('translated'));
  }

  protected revert(row: Row): void {
    row.target.set(row.savedTarget());
    row.state.set(row.savedState());
  }

  protected onTargetInput(row: Row, event: Event): void {
    row.target.set((event.target as HTMLTextAreaElement).value);
    if (UNTRANSLATED_STATES.includes(row.state()) && row.target().trim())
      row.state.set('translated');
  }

  protected onStateChange(row: Row, event: Event): void {
    row.state.set((event.target as HTMLSelectElement).value);
  }

  private applyTranslations(results: { id: string; target?: string; error?: string }[]): void {
    const byId = new Map(this.rows().map((row) => [row.unit.id, row]));
    const failures: string[] = [];
    for (const result of results) {
      const row = byId.get(result.id);
      if (!row) continue;
      if (result.error !== undefined || result.target === undefined) {
        failures.push(`${result.id}: ${result.error ?? 'no translation returned'}`);
        continue;
      }
      row.target.set(result.target);
      row.state.set('translated');
    }
    const done = results.length - failures.length;
    this.notice.set(`Translated ${done} key${done === 1 ? '' : 's'}. Remember to save.`);
    if (failures.length) this.error.set(`Failed: ${failures.join('; ')}`);
  }

  private setFile(file: XliffFile): void {
    this.file.set(file);
    this.rows.set(
      file.units.map((unit) => {
        const target = signal(unit.target);
        const state = signal(unit.state || (unit.hasTarget ? 'new' : ''));
        const savedTarget = signal(target());
        const savedState = signal(state());
        return {
          unit,
          target,
          state,
          savedTarget,
          savedState,
          translating: signal(false),
          dirty: computed(() => target() !== savedTarget() || state() !== savedState()),
        };
      })
    );
  }

  private reset(): void {
    this.file.set(null);
    this.rows.set([]);
    this.error.set('');
    this.notice.set('');
  }

  private fail(err: unknown, cleanup?: () => void): void {
    this.busy.set('');
    cleanup?.();
    const message =
      err instanceof HttpErrorResponse
        ? err.error?.error ?? err.message
        : (err as Error)?.message ?? 'Unexpected error';
    this.error.set(message);
  }
}
