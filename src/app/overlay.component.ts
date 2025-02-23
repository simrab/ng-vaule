import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'vaul-overlay',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="vaul-overlay"
      #overlayRef
      [attr.data-vaul-overlay]=""
      [attr.data-state]="isOpen() ? 'open' : 'closed'"
    ></div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .vaul-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.4);
        pointer-events: none;
        z-index: -1;
        opacity: 0;
        top: 0;
        bottom: 0;
        left: 0;
        right: 0;
        transition: all 0.3s cubic-bezier(0.32, 0.72, 0, 1);
      }

      .vaul-overlay[data-state='open'] {
        opacity: 1;
        pointer-events: auto;
        z-index: var(--vaul-overlay-z-index, 998);
      }
    `,
  ],
})
export class OverlayComponent {
  isOpen = input<boolean>();
}
