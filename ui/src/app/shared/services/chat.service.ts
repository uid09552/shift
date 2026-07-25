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
}

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
}
