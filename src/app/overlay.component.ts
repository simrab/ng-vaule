import { AsyncPipe } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { map, Subject } from 'rxjs';
import { DrawerService } from './services/drawer.service';

@Component({
  selector: 'vaul-overlay',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="vaul-overlay"
      #overlayRef
      [attr.data-vaul-overlay]=""
      [attr.data-state]="(isOpen$ | async) ? 'open' : 'closed'"
      (pointerup)="onRelease($event)"
    ></div>
  `,
  styles: [
    `
      .vaul-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        pointer-events: none;
        z-index: -1;
        opacity: 0;
        transition: all 0.3s cubic-bezier(0.32, 0.72, 0, 1);
      }

      .vaul-overlay[data-state='open'] {
        opacity: 1;
        pointer-events: auto;
        z-index: var(--vaul-overlay-z-index, 998);
      }
    `,
  ],
  imports: [AsyncPipe],
})
export class OverlayComponent implements AfterViewInit, OnDestroy {
  private readonly drawerService = inject(DrawerService);
  private readonly destroy$ = new Subject<void>();

  @ViewChild('overlayRef') overlayRef!: ElementRef<HTMLDivElement>;

  readonly isOpen$ = this.drawerService.isOpen$;

  ngAfterViewInit() {
    this.drawerService.setOverlayRef(this.overlayRef.nativeElement);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  onRelease(event: PointerEvent) {
    this.drawerService.onRelease(event);
  }
}
