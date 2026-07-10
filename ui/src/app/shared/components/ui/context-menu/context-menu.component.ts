import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, ViewChild } from '@angular/core';
import { ContextMenuService, ContextMenuState } from './context-menu.service';

@Component({
  selector: 'app-context-menu',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './context-menu.component.html',
})
export class ContextMenuComponent {
  state: ContextMenuState | null = null;

  @ViewChild('menuRef') menuRef?: ElementRef<HTMLDivElement>;

  constructor(private contextMenuService: ContextMenuService) {
    this.contextMenuService.state$.subscribe((s) => (this.state = s));
  }

  runAction(action: () => void): void {
    this.contextMenuService.close();
    action();
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(event: MouseEvent): void {
    if (!this.state) return;
    if (!this.menuRef?.nativeElement.contains(event.target as Node)) {
      this.contextMenuService.close();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.contextMenuService.close();
  }

  @HostListener('window:blur')
  onWindowBlur(): void {
    this.contextMenuService.close();
  }
}
