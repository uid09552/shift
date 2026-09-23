import { CommonModule } from '@angular/common';
import { AfterViewChecked, Component, ElementRef, ViewChild, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationStart, Router } from '@angular/router';
import { Marked, Renderer } from 'marked';
import {
  ACCEPTED_UPLOAD_TYPES,
  ChatResponse,
  ChatService,
  MAX_UPLOAD_BYTES,
} from '../../services/chat.service';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  // Set on the bubble standing in for an attached file, so it renders as a
  // document chip rather than as the user having typed a filename.
  attachment?: string;
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
  changeDetection: ChangeDetectionStrategy.Eager,
  templateUrl: './chat-widget.component.html',
})
export class ChatWidgetComponent implements AfterViewChecked {
  open = false;
  hidden = false;
  sending = false;
  draft = '';
  messages: ChatMessage[] = [];
  readonly acceptedTypes = ACCEPTED_UPLOAD_TYPES;

  @ViewChild('scrollAnchor') private scrollAnchor?: ElementRef<HTMLDivElement>;
  @ViewChild('fileInput') private fileInput?: ElementRef<HTMLInputElement>;

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
    this.chatService.sendMessage(text).subscribe(this.replyHandler());
  }

  pickFile(): void {
    if (!this.sending) this.fileInput?.nativeElement.click();
  }

  /**
   * Send an attached roster file. Whatever is in the draft box goes with it as
   * a note — "this is April", say — since that is often exactly the bit the
   * file itself doesn't state.
   */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Clear immediately, so picking the same file twice still fires a change.
    input.value = '';
    if (!file || this.sending) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      this.messages.push({
        role: 'assistant',
        text: `${file.name} is too large — the limit is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
        error: true,
      });
      return;
    }

    const note = this.draft.trim();
    this.messages.push({ role: 'user', text: note, attachment: file.name });
    this.draft = '';
    this.sending = true;
    this.chatService.uploadFile(file, note || undefined).subscribe(this.replyHandler());
  }

  /** Shared handling of an agent reply, for both a typed message and an upload. */
  private replyHandler() {
    return {
      next: (res: ChatResponse) => {
        this.sending = false;
        const reply = res.reply || '…';
        this.messages.push({ role: 'assistant', text: reply, html: this.render(reply) });
        if (res.ui_action?.action === 'navigate' && res.ui_action['path']) {
          this.router.navigateByUrl(res.ui_action['path'] as string);
        }
      },
      error: (err: { error?: { error?: string } }) => {
        this.sending = false;
        this.messages.push({
          role: 'assistant',
          // The agent explains a file it could not read in words the user can
          // act on ("save it as .xlsx"), so pass that through rather than
          // flattening it to a generic failure.
          text: err?.error?.error || 'Something went wrong reaching the assistant. Please try again.',
          error: true,
        });
      },
    };
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
