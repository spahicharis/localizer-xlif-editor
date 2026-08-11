import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { FileSummary, TranslateResponse, XliffFile } from './xliff.models';

const API = '/api';

@Injectable({ providedIn: 'root' })
export class XliffService {
  private readonly http = inject(HttpClient);

  readonly downloadUrl = (fileId: string) => `${API}/files/${fileId}/download`;

  states(): Observable<{ states: string[] }> {
    return this.http.get<{ states: string[] }>(`${API}/states`);
  }

  list(): Observable<{ files: FileSummary[] }> {
    return this.http.get<{ files: FileSummary[] }>(`${API}/files`);
  }

  load(fileId: string): Observable<XliffFile> {
    return this.http.get<XliffFile>(`${API}/files/${fileId}`);
  }

  upload(file: File): Observable<XliffFile> {
    const body = new FormData();
    body.append('file', file);
    return this.http.post<XliffFile>(`${API}/files`, body);
  }

  save(
    fileId: string,
    units: { id: string; target: string; state: string }[]
  ): Observable<XliffFile & { saved: number }> {
    return this.http.put<XliffFile & { saved: number }>(`${API}/files/${fileId}/units`, { units });
  }

  translate(fileId: string, ids: string[]): Observable<TranslateResponse> {
    return this.http.post<TranslateResponse>(`${API}/files/${fileId}/translate`, { ids });
  }
}
