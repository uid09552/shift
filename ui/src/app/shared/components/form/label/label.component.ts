import { CommonModule } from '@angular/common';
import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-label',
  imports: [CommonModule],
  templateUrl: './label.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: ``
})
export class LabelComponent {
  @Input() for?: string;
  @Input() className = '';
}
