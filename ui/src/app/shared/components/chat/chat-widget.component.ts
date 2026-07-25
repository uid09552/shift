import { CommonModule } from '@angular/common';
import { AfterViewChecked, Component, ElementRef, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationStart, Router } from '@angular/router';
import { Marked, Renderer } from 'marked';
import { ChatService } from '../../services/chat.service';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  // Assistant replies are markdown; `html` is the rendered form bound with
  // [innerHTML] (Angular sanitizes it). Absent for user and error messages,
  // which are shown verbatim.
  html?: string;
  error?: boolean;
}

// Routes that shouldn't show the assistant (not signed in yet).
const HIDDEN_ON = ['/signin', '/signup'];

// Tables are the widest thing the agent sends and the panel is narrow, so
// wrap each one in a horizontally scrollable box (styled in styles.css).
// Must be a plain function, not an arrow or a bound method: marked calls it
// with its own renderer as `this`, and the base implementation needs that
// instance's `parser` to render the cells.
const renderer = new Renderer();
renderer.table = function (token) {
  return `<div class="md-table">${Renderer.prototype.table.call(this, token)}</div>`;
};

// Own instance rather than the `marked` singleton, so these options stay
// local to the chat widget.
const markdown = new Marked({ gfm: true, breaks: true, renderer });

@Component({
  selector: 'app-chat-widget',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chat-widget.component.html',
})
export class ChatWidgetComponent implements AfterViewChecked {
  open = false;
  hidden = false;
  sending = false;
  draft = '';
  messages: ChatMessage[] = [];

  @ViewChild('scrollAnchor') private scrollAnchor?: ElementRef<HTMLDivElement>;

  constructor(private chatService: ChatService, private router: Router) {
    this.hidden = HIDDEN_ON.some((p) => this.router.url.startsWith(p));
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.hidden = HIDDEN_ON.some((p) => event.url.startsWith(p));
      }
    });
  }

  ngAfterViewChecked(): void {
    this.scrollAnchor?.nativeElement.scrollIntoView({ behavior: 'smooth' });
  }

  toggle(): void {
    this.open = !this.open;
  }

  send(): void {
    const text = this.draft.trim();
    if (!text || this.sending) return;

    this.messages.push({ role: 'user', text });
    this.draft = '';
    this.sending = true;

    this.chatService.sendMessage(text).subscribe({
      next: (res) => {
        this.sending = false;
        const reply = res.reply || '…';
        this.messages.push({ role: 'assistant', text: reply, html: this.render(reply) });
        if (res.ui_action?.action === 'navigate' && res.ui_action['path']) {
          this.router.navigateByUrl(res.ui_action['path'] as string);
        }
      },
      error: () => {
        this.sending = false;
        this.messages.push({
          role: 'assistant',
          text: 'Something went wrong reaching the assistant. Please try again.',
          error: true,
        });
      },
    });
  }

  private render(text: string): string {
    return markdown.parse(text, { async: false });
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }
}
