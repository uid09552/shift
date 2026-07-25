import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { DropdownComponent } from '../../ui/dropdown/dropdown.component';
import { DropdownItemComponent } from '../../ui/dropdown/dropdown-item/dropdown-item.component';
import { ModalComponent } from '../../ui/modal/modal.component';
import { AuditLog, AuditLogService } from '../../../services/audit-log.service';

const MAX_NOTIFICATIONS = 10;

@Component({
  selector: 'app-notification-dropdown',
  templateUrl: './notification-dropdown.component.html',
  imports: [CommonModule, RouterModule, DropdownComponent, DropdownItemComponent, ModalComponent],
})
export class NotificationDropdownComponent {
  isOpen = false;

  logs: AuditLog[] = [];
  loading = false;
  loaded = false;

  showDetail = false;
  selectedLog: AuditLog | null = null;

  constructor(private auditLogService: AuditLogService) {}

  /** Notifications are only fetched once the user opens the dropdown — no background polling. */
  toggleDropdown(): void {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.loadLogs();
    }
  }

  private loadLogs(): void {
    this.loading = true;
    this.auditLogService.listAuditLogs({ limit: MAX_NOTIFICATIONS }).subscribe({
      next: (r) => {
        this.logs = r.data.slice(0, MAX_NOTIFICATIONS);
        this.loading = false;
        this.loaded = true;
      },
      error: (e) => {
        console.error('Failed to load audit log notifications:', e);
        this.loading = false;
      },
    });
  }

  closeDropdown(): void {
    this.isOpen = false;
  }

  openDetail(log: AuditLog): void {
    this.selectedLog = log;
    this.showDetail = true;
    this.closeDropdown();
  }

  closeDetail(): void {
    this.showDetail = false;
    this.selectedLog = null;
  }

  /** "employee.create" -> "Employee created" */
  actionLabel(action: string): string {
    const [entity, verb] = action.split('.');
    const verbLabel: Record<string, string> = {
      create: 'created',
      update: 'updated',
      delete: 'deleted',
      optimize: 'optimization requested',
    };
    const entityLabel = entity ? entity.charAt(0).toUpperCase() + entity.slice(1).replace(/_/g, ' ') : action;
    return `${entityLabel} ${verbLabel[verb] ?? verb ?? ''}`.trim();
  }

  relativeTime(isoDate: string): string {
    const date = new Date(isoDate.endsWith('Z') ? isoDate : isoDate + 'Z');
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }

  /** Pretty-prints `changes` as JSON when possible, otherwise returns it as-is. */
  formatChanges(changes: string | null): string {
    if (!changes) return '—';
    try {
      return JSON.stringify(JSON.parse(changes), null, 2);
    } catch {
      return changes;
    }
  }
}
