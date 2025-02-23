import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, inject, input, OnDestroy, ViewChild } from '@angular/core';
import { Subject } from 'rxjs';
import { take, takeUntil } from 'rxjs/operators';
import { DrawerService } from './services/drawer.service';
import { SnapPointsService } from './services/snap-points.service';

@Component({
  selector: 'vaul-handle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="vaul-handle"
      #handleRef
      [attr.data-vaul-handle]=""
      [attr.data-vaul-drawer-visible]="(isOpen$| async) ? 'true' : 'false'"
      [class.vaul-dragging]="(isDragging$| async)"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointercancel)="onPointerCancel($event)"
      aria-hidden="true"
    >
      <span 
        class="vaul-handle-hitarea" 
        [class.vaul-handle-disabled]="disabled()"
        aria-hidden="true"
      >
        <ng-content></ng-content>
      </span>
    </div>
  `,
  imports: [AsyncPipe],
  styles: [`
    .vaul-handle {
      width: 100%;
      user-select: none;
      touch-action: none;
      cursor: grab;
    }

    .vaul-handle-hitarea {
      width: 100%;
      height: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .vaul-handle.vaul-dragging {
      cursor: grabbing;
    }

    .vaul-handle-disabled {
      pointer-events: none;
    }
  `]
})
export class HandleComponent implements OnDestroy {
  private readonly drawerService = inject(DrawerService);
  private readonly snapPointsService = inject(SnapPointsService);
  private readonly destroy$ = new Subject<void>();

  // Create computed signals from observables
  readonly isOpen$ = this.drawerService.isOpen$;
  readonly isDragging$ = this.drawerService.isDragging$;
  readonly direction$ = this.drawerService.direction$;

  readonly disabled = input(false);
  
  @ViewChild('handleRef') handleRef!: ElementRef<HTMLDivElement>;

  private initialSnapPoint: number | null = null;

  constructor() {
    // Subscribe to activeSnapPointIndex$
    this.snapPointsService.activeSnapPointIndex$
      .pipe(takeUntil(this.destroy$))
      .subscribe(index => {
        this.initialSnapPoint = index;
      });
  }

  onPointerDown(event: PointerEvent) {
    if (this.disabled()) return;

    // Capture the pointer to ensure all events go to this element
    this.handleRef.nativeElement.setPointerCapture(event.pointerId);
    
    // Start dragging
    this.drawerService.onPress(event);
  }

  onPointerMove(event: PointerEvent) {
    if (this.disabled()) return;
    // Only handle move if we're dragging
    let isDragging = false;
    this.drawerService.isDragging$.pipe(
      take(1)
    ).subscribe(dragging => isDragging = dragging as boolean);
    if (!isDragging) return;

    // Prevent default to avoid text selection
    event.preventDefault();
    // Update drag position
    this.drawerService.onDrag(event);
  }

  onPointerUp(event: PointerEvent) {
    if (this.disabled()) return;

    // Release pointer capture
    this.handleRef.nativeElement.releasePointerCapture(event.pointerId);

    // End dragging
    this.drawerService.onRelease(event);
  }

  onPointerCancel(event: PointerEvent) {
    if (this.disabled()) return;

    // Release pointer capture
    this.handleRef.nativeElement.releasePointerCapture(event.pointerId);

    // End dragging
    this.drawerService.onRelease(event);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
} 