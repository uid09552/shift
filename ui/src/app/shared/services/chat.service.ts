import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ChatUiAction {
  action: string;
  path?: string;
  [key: string]: unknown;
}

export interface ChatResponse {
  session_id: string;
  reply: string;
  ui_action: ChatUiAction | null;
  // Only on an upload reply — what the agent made of the attached file before
  // it read it. Not currently rendered, but it carries the upload_id the
  // conversation refers to afterwards, which is worth having when debugging.
  upload?: ChatUpload;
}

export interface ChatUpload {
  upload_id: string;
  filename: string;
  kind: string;
  sheets: { name: string; rows: number; columns: number }[];
}

/** File types the agent can read a roster out of (agent/documents.py). */
export const ACCEPTED_UPLOAD_TYPES = '.csv,.tsv,.txt,.xlsx,.xlsm,.pdf';

/** Matches the agent's own MAX_UPLOAD_BYTES, so an oversized file is caught
 *  here rather than after a pointless round trip. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const SESSION_ID_KEY = 'shift-agent-chat-session-id';

@Injectable({
  providedIn: 'root',
})
export class ChatService {
  private readonly apiUrl = '/agent';

  constructor(private http: HttpClient) {}

  get sessionId(): string {
    let id = localStorage.getItem(SESSION_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_ID_KEY, id);
    }
    return id;
  }

  sendMessage(message: string): Observable<ChatResponse> {
    return this.http.post<ChatResponse>(`${this.apiUrl}/chat`, {
      message,
      session_id: this.sessionId,
    });
  }

  /**
   * Attach a roster document (PDF/CSV/Excel) to the conversation.
   *
   * The agent parses it, works out which columns hold the people, dates and
   * shifts, and replies with what it read — it does not write anything until
   * the user confirms in a following message, which is an ordinary sendMessage.
   */
  uploadFile(file: File, message?: string): Observable<ChatResponse> {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('session_id', this.sessionId);
    if (message) {
      form.append('message', message);
    }
    // No explicit Content-Type: the browser has to set the multipart boundary.
    return this.http.post<ChatResponse>(`${this.apiUrl}/chat/upload`, form);
  }
}
