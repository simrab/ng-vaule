import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DrawerComponent } from './drawer.component';
import { OverlayComponent } from './overlay.component';
import { DrawerService } from './services/drawer.service';
import { DrawerDirection } from './types';
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [DrawerComponent, OverlayComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button class="trigger-button" (click)="toggleDrawer()">{{ isOpen() ? 'Close' : 'Open' }} Drawer</button>
    <vaul-overlay [direction]="drawerDirection" />

    <vaul-drawer [open]="isOpen()" [initialDrawerHeight]="380" (openChange)="setIsOpen($event)" [direction]="drawerDirection">
      <div class="drawer-content">
        <div class="content">
          <h2>Drawer Example</h2>
          <p>This is a drawer with snap points at 50% and 80% of the screen height.</p>
        </div>
      </div>
    </vaul-drawer>
  `,
  styles: [
    `
      .trigger-button {
        position: fixed;
        top: 20px;
        left: 20px;
        padding: 12px 24px;
        background: #007bff;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 16px;
        z-index: 1000;
      }

      .trigger-button:hover {
        background: #0056b3;
      }

      .drawer-wrapper {
        position: relative;
        z-index: var(--vaul-drawer-z-index);
      }

      .drawer-content {
        background: white;
        border-radius: 8px 8px 0 0;
        height: 100%;
        display: flex;
        flex-direction: column;
        position: relative;
        min-height: 200px;
      }

      .content {
        padding: 16px;
        flex: 1;
        overflow-y: auto;
      }

      h2 {
        margin: 0 0 16px;
        font-size: 24px;
      }

      p {
        margin: 0;
        color: #666;
      }
    `,
  ],
})
export class AppComponent {
  private readonly drawerService = inject(DrawerService);
  readonly isOpen = signal(false);
  public drawerDirection = DrawerDirection.BOTTOM;

  setIsOpen(value: boolean) {
    this.isOpen.set(value);
    this.drawerService.setIsOpen(value);
  }

  toggleDrawer() {
    this.setIsOpen(!this.isOpen());
  }
}
