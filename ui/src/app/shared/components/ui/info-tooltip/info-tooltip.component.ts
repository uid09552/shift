import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

/**
 * Small "i" icon that reveals a short explanatory tooltip on hover or keyboard
 * focus. Used next to settings/labels where the effect of a value isn't
 * self-evident from the label alone.
 */
@Component({
  selector: 'app-info-tooltip',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './info-tooltip.component.html',
})
export class InfoTooltipComponent {
  /** Explanatory text shown in the tooltip, e.g. what increasing/decreasing the value does. */
  @Input() text = '';
}
