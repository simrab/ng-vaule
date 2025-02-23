import {
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  OnInit,
  ViewContainerRef,
  inject,
  input,
  model
} from '@angular/core';
import { DrawerComponent } from './drawer.component';
import { DrawerService } from './services/drawer.service';
import { isVertical, requestTimeout } from './services/helpers';
import { DrawerDirection, DrawerDirectionType } from './types';
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button class="trigger-button" (click)="toggleDrawer()">{{ isOpen() ? 'Close' : 'Open' }} Drawer</button>
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
        z-index: 10000000000;
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
export class AppComponent implements OnInit {
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly drawerService = inject(DrawerService);
  readonly isOpen = model(false);
  readonly intialDrawerHeightorWidth = model<number>(380);
  private componentRef: ComponentRef<DrawerComponent> | null = null;
  public drawerDirection = input<DrawerDirectionType>(DrawerDirection.BOTTOM);
  public isVertical = isVertical;

  ngOnInit(): void {
    this.drawerService.direction$.next(this.drawerDirection());
  }

  setIsOpen(value: boolean) {
    this.isOpen.set(value);
    this.drawerService.setIsOpen(value);
  }

  toggleDrawer() {
    this.setIsOpen(!this.isOpen());
    if (this.componentRef === null) {
      this.componentRef = this.viewContainer.createComponent(DrawerComponent);
    }
    if (this.isOpen() === false) {
      this.componentRef.instance.resetStylesWrapper();
      this.removeDrawer();
    }
    if (this.componentRef) {
      this.componentRef.instance.initialDrawerHeightorWidth = this.intialDrawerHeightorWidth;
      this.componentRef.instance.isOpen = this.isOpen;
      this.componentRef.instance.direction = this.drawerDirection;
      this.componentRef.instance.removeDrawer.subscribe(() => {
        this.removeDrawer();
      });
    }
  }
  private removeDrawer() {
    requestTimeout(
      () => {
        this.componentRef?.destroy();
        this.componentRef = null;
      },
      400,
      () => {},
    );
  }
}
