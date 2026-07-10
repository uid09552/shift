import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ConfirmDialogComponent } from './shared/components/ui/confirm-dialog/confirm-dialog.component';
import { ContextMenuComponent } from './shared/components/ui/context-menu/context-menu.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterModule,
    ConfirmDialogComponent,
    ContextMenuComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  title = 'ShiftPlanner';
}
