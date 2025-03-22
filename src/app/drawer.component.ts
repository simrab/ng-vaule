import { AsyncPipe } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  model,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Subject } from 'rxjs';
import { HandleComponent } from './handle.component';
import { DOUBLE_TAP_TIMEOUT, DRAG_CLASS, TRANSITIONS, WINDOW_TOP_OFFSET } from './services/constants';
import { DrawerService } from './services/drawer.service';
import { isInput, set } from './services/helpers';
import { DrawerDirection } from './types';
import { isMobileFirefox } from './services/browser';

@Component({
  selector: 'vaul-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="vaul-drawer"
      #drawerRef
      (click)="handleStartCycle(drawerRef)"
      [attr.data-vaul-drawer]=""
      [attr.data-vaul-drawer-direction]="direction()"
      [attr.data-state]="(isOpen$ | async) ? 'open' : 'closed'"
      [attr.data-vaul-snap-points]="!!snapPoints() ? 'true' : 'false'"
      [style.height]="drawerHeight()"
      (drag)="onDrag($event, drawerRef)"
      (pointerdown)="onPointerDown($event, drawerRef)"
      (pointermove)="onPointerMove($event, drawerRef)"
      (pointerout)="onPointerOut(drawerRef)"
      (pointerup)="onPointerUp($event, drawerRef)"
      (pointercancel)="onRelease($event, drawerRef)"
      (contextmenu)="onContextMenu(drawerRef)"
    >
      <div class="drawer-content">
        <vaul-handle [drawerRef]="drawerRef">
          <div class="handle-indicator"></div>
        </vaul-handle>
        <ng-content></ng-content>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: var(--vaul-drawer-z-index, 999);
        display: flex;
        flex-direction: column;
        pointer-events: none;
        transform-origin: bottom center;
        height: 100%;
      }

      .vaul-drawer {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        width: 100%;
        height: auto;
        overflow: hidden;
        pointer-events: auto;
        background: white;
        border-radius: 8px 8px 0 0;
        will-change: transform;
        transform-origin: bottom center;
      }
    `,
  ],
  imports: [AsyncPipe, HandleComponent],
})
export class DrawerComponent implements AfterViewInit, OnDestroy {
fixed = input(true);
  private readonly drawerService = inject(DrawerService);
  private readonly destroy$ = new Subject<void>();

  readonly open = input(false);
  readonly direction = input<DrawerDirection>('bottom');
  readonly shouldScaleBackground = input(false);
  readonly dismissible = input(true);
  readonly modal = input(true);
  readonly nested = input(false);
  readonly repositionInputs = input(true);
  readonly autoFocus = input(false);
  readonly snapPoints = model<number[] | undefined>(undefined);

  readonly openChange = output<boolean>();

  drawerRef = viewChild<ElementRef<HTMLDivElement>>('drawerRef');

  private readonly initialDrawerHeight = signal<number | null>(null);
  private readonly keyboardIsOpen = signal(false);
  private readonly previousDiffFromInitial = signal(0);
  drawerHeight = signal<string | null>(null);

  isOpen$ = this.drawerService.isOpen$;
  lastKnownPointerEventRef: PointerEvent | null = null;
  shouldCancelInteraction: any;
  preventCycle: boolean = false;
  activeSnapPoint: any;

  constructor() {
    this.drawerService.openTime$.next(new Date());
    // Watch open state
    effect(() => {
      const isOpen = this.open();
      this.drawerService.setIsOpen(isOpen);
    });

    effect(() => {
      this.drawerService.setDirection(this.direction());
      this.drawerService.setScaleBackground(this.shouldScaleBackground());
      this.drawerService.setModal(this.modal());
      this.drawerService.setNested(this.nested());
    });

    // Setup visual viewport handling
    this.setupVisualViewport();
  }
  private onVisualViewportChange() {
    const drawer = this.drawerRef()?.nativeElement;
    if (!drawer) return;
    const focusedElement = document.activeElement as HTMLElement;
    if (isInput(focusedElement) || this.keyboardIsOpen()) {
      const visualViewportHeight = window.visualViewport?.height || 0;
      const totalHeight = window.innerHeight;
      // This is the height of the keyboard
      let diffFromInitial = totalHeight - visualViewportHeight;
      const drawerHeight = drawer.getBoundingClientRect().height || 0;
      // Adjust drawer height only if it's tall enough
      const isTallEnough = drawerHeight > totalHeight * 0.8;

      if (!this.initialDrawerHeight()) {
        this.initialDrawerHeight.set(drawerHeight);
      }
      const offsetFromTop = drawer.getBoundingClientRect().top;

      // visualViewport height may change due to somq e subtle changes to the keyboard. Checking if the height changed by 60 or more will make sure that they keyboard really changed its open state.
      if (Math.abs(this.previousDiffFromInitial() - diffFromInitial) > 60) {
        this.keyboardIsOpen.set(!this.keyboardIsOpen());
      }
      const snapPoints = this.snapPoints();
      this.previousDiffFromInitial.set(diffFromInitial);
      // We don't have to change the height if the input is in view, when we are here we are in the opened keyboard state so we can correctly check if the input is in view
      if (drawerHeight > visualViewportHeight || this.keyboardIsOpen()) {
        const height = drawer.getBoundingClientRect().height;
        let newDrawerHeight = height;

        if (height > visualViewportHeight) {
          newDrawerHeight = visualViewportHeight - (isTallEnough ? offsetFromTop : WINDOW_TOP_OFFSET);
        }
        // When fixed, don't move the drawer upwards if there's space, but rather only change it's height so it's fully scrollable when the keyboard is open
        if (this.fixed()) {
          drawer.style.height = `${height - Math.max(diffFromInitial, 0)}px`;
        } else {
          drawer.style.height = `${Math.max(newDrawerHeight, visualViewportHeight - offsetFromTop)}px`;
        }
      } else if (!isMobileFirefox()) {
        drawer.style.height = `${this.initialDrawerHeight()}px`;
      }

      if (snapPoints && snapPoints.length > 0 && !this.keyboardIsOpen()) {
        drawer.style.bottom = `0px`;
      } else {
        // Negative bottom value would never make sense
        drawer.style.bottom = `${Math.max(diffFromInitial, 0)}px`;
      }
    }
  }

  private setupVisualViewport() {
    if (typeof window === 'undefined' || !window.visualViewport || !this.repositionInputs()) {
      return;
    }
    window.visualViewport.addEventListener('resize', this.onVisualViewportChange);
    this.destroy$.subscribe(() => {
      window.visualViewport?.removeEventListener('resize', this.onVisualViewportChange);
    });
  }

  // private handleInputFocus() {
  //   const visualViewportHeight = window.visualViewport?.height || 0;
  //   const totalHeight = window.innerHeight;
  //   const diffFromInitial = totalHeight - visualViewportHeight;
  //   const drawerHeight = this.drawerRef()?.nativeElement.getBoundingClientRect().height ?? 0;
  //   this.drawerService.drawerHeight$.next(drawerHeight);
  //   const isTallEnough = drawerHeight > totalHeight * 0.8;

  //   if (!this.initialDrawerHeight()) {
  //     this.initialDrawerHeight.set(drawerHeight);
  //     this.drawerService.drawerHeight$.next(drawerHeight);
  //   }

  //   if (Math.abs(this.previousDiffFromInitial() - diffFromInitial) > 60) {
  //     this.keyboardIsOpen.set(!this.keyboardIsOpen());
  //   }

  //   this.previousDiffFromInitial.set(diffFromInitial);
  //   this.updateDrawerHeight(drawerHeight, visualViewportHeight, isTallEnough);
  // }

  // private updateDrawerHeight(drawerHeight: number, visualViewportHeight: number, isTallEnough: boolean) {
  //   if (drawerHeight > visualViewportHeight || this.keyboardIsOpen()) {
  //     const offsetFromTop = this.drawerRef()?.nativeElement.getBoundingClientRect().top;
  //     let newHeight = drawerHeight;
  //     if (drawerHeight > visualViewportHeight) {
  //       newHeight = visualViewportHeight - (isTallEnough ? (offsetFromTop ?? 0) : 0);
  //     }
  //     this.drawerHeight.set(`${Math.max(newHeight, visualViewportHeight - (offsetFromTop ?? 0))}px`);
  //     this.drawerService.drawerHeight$.next(Math.max(newHeight, visualViewportHeight - (offsetFromTop ?? 0)));
  //   } else {
  //     this.drawerService.drawerHeight$.next(this.initialDrawerHeight());
  //     this.drawerHeight.set(`${this.initialDrawerHeight()}px`);
  //   }
  // }

  // private isInput(element: Element | null): boolean {
  //   if (!element) return false;
  //   return (
  //     (element instanceof HTMLInputElement && !this.nonTextInputTypes.has(element.type)) ||
  //     element instanceof HTMLTextAreaElement ||
  //     (element instanceof HTMLElement && element.isContentEditable)
  //   );
  // }
  handleStartCycle(element: HTMLDivElement) {
    // Stop if this is the second click of a double click
    if (this.shouldCancelInteraction) {
      this.handleCancelInteraction();
      return;
    }
    window.setTimeout(() => {
      this.handleCycleSnapPoints(element);
    }, DOUBLE_TAP_TIMEOUT);
  }
  handleStartInteraction() {
    this.shouldCancelInteraction = true;
  }
  handleCancelInteraction() {
    this.shouldCancelInteraction = false;
  }
  handleCycleSnapPoints(element: HTMLDivElement) {
    // Prevent accidental taps while resizing drawer
    if (this.drawerService.isDragging$.value || this.preventCycle || this.shouldCancelInteraction) {
      this.handleCancelInteraction();
      return;
    }
    // Make sure to clear the timeout id if the user releases the handle before the cancel timeout
    this.handleCancelInteraction();

    if (!this.snapPoints() || this.snapPoints()?.length === 0) {
      if (!this.dismissible()) {
        this;
        this.drawerService.closeDrawer(element);
      }
      return;
    }
  }
  private readonly nonTextInputTypes = new Set([
    'checkbox',
    'radio',
    'range',
    'color',
    'file',
    'image',
    'button',
    'submit',
    'reset',
  ]);

  ngAfterViewInit() {
    const drawerRef = this.drawerRef();
    if (!drawerRef) return;
    if (drawerRef.nativeElement) {
      this.drawerService.setDrawerRef(drawerRef.nativeElement || null);
      const offset = drawerRef.nativeElement.getBoundingClientRect().height || 0;
      const transform = `translateY(${offset}px)`;
      set(drawerRef.nativeElement, {
        transition: `transform ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
        transform,
      });
    }
    if (this.direction()) {
      this.drawerService.setDirection(this.direction());
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.drawerService.setDrawerRef(null);
  }

  onPointerDown(event: PointerEvent, element: HTMLDivElement) {
    this.drawerService.pointerStart$.next({ y: event.pageY });
    this.onPress(event, element);
  }
  onPointerUp(event: PointerEvent, element: HTMLDivElement) {
    this.drawerService.pointerStart$.next(null);
    this.drawerService.wasBeyondThePoint$.next(false);
    this.onRelease(event, element);
  }
  onPointerMove(event: PointerEvent, element: HTMLDivElement) {
    this.lastKnownPointerEventRef = event;
    if (!this.drawerService.pointerStart$.value) return;
    const yPosition = event.pageY - this.drawerService.pointerStart$.value.y;

    const swipeStartThreshold: number = event.pointerType === 'touch' ? 10 : 2;
    const delta = { y: yPosition };
    const direction = yPosition > 0 ? 'bottom' : 'top';

    const isAllowedToSwipe = this.isDeltaInDirection(delta, direction, swipeStartThreshold);
    if (isAllowedToSwipe) this.onDrag(event, element);
    else if (Math.abs(yPosition) > swipeStartThreshold) {
      this.drawerService.pointerStart$.next(null);
    }
  }
  onPointerOut(element: HTMLDivElement) {
    this.handleOnPointerUp(this.lastKnownPointerEventRef, element);
  }

  private isDeltaInDirection(delta: { y: number }, direction: string, threshold = 0) {
    if (this.drawerService.wasBeyondThePoint$.value) return true;

    const deltaY = Math.abs(delta.y);
    const dFactor = ['bottom'].includes(direction) ? 1 : -1;

    const isReverseDirection = delta.y * dFactor < 0;
    if (!isReverseDirection && deltaY >= 0 && deltaY <= threshold) {
      return false;
    }

    this.drawerService.wasBeyondThePoint$.next(true);
    return true;
  }

  onContextMenu(element: HTMLDivElement) {
    if (this.lastKnownPointerEventRef) {
      this.handleOnPointerUp(this.lastKnownPointerEventRef, element);
    }
  }
  onPress(event: PointerEvent, element: HTMLDivElement) {
    this.drawerService.isDragging$.next(true);
    this.drawerService.onPress(event, element);
  }

  onDrag(event: DragEvent | PointerEvent, element: HTMLDivElement) {
    this.drawerService.onDrag(event, element);
  }

  cancelDrag(element?: HTMLDivElement) {
    if (!this.drawerService.isDragging$.value || !element) return;
    element.classList.remove(DRAG_CLASS);
    this.drawerService.isAllowedToDrag$.next(false);
    this.drawerService.isDragging$.next(false);
    this.drawerService.dragEndTime$.next(new Date());
  }
  onRelease(event: PointerEvent, element: HTMLDivElement) {
    this.drawerService.isDragging$.next(false);
    this.drawerService.isAllowedToDrag$.next(false);
    this.drawerService.onRelease(event, element);
  }
  private handleOnPointerUp(event: PointerEvent | null, element: HTMLDivElement) {
    if (!event) return;
    this.drawerService.pointerStart$.next(null);
    this.drawerService.wasBeyondThePoint$.next(false);
    this.onRelease(event, element);
  }
}
