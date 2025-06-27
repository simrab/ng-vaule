import { DOCUMENT } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  Inject,
  inject,
  input,
  model,
  output,
  signal,
  viewChild
} from '@angular/core';
import { HandleComponent } from './handle.component';
import { isIOS, isMobileFirefox } from './services/browser';
import {
  BODY_DRAG_CLASS,
  BORDER_RADIUS,
  CLOSE_THRESHOLD,
  DRAG_CLASS,
  LONG_PRESS_TIMEOUT,
  SCROLL_LOCK_TIMEOUT,
  TRANSITIONS,
  VELOCITY_THRESHOLD,
  WINDOW_TOP_OFFSET,
} from './services/constants';
import { DrawerService } from './services/drawer.service';
import { isInput, isVertical, requestTimeout, set } from './services/helpers';
import { DrawerDirection, DrawerDirectionType } from './types';

@Component({
  selector: 'vaul-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div id="wrapper" class="data-vaul-drawer-wrapper"> </div>
    <div
      class="vaul-overlay"
      #overlayRef
      [attr.data-vaul-overlay]=""
      [attr.data-state]="isOpen() ? 'open' : 'closed'"
    ></div>
      <div
        class="data-vaul-drawer"
        role="dialog"
        id="radix-:rg:"
        aria-describedby="radix-:ri:"
        aria-labelledby="radix-:rh:"
        #drawer
        (click)="handleStartCycle(drawer)"
        [class]="[isVerticalOrientation() ? 'vertical' : 'horizontal', direction() === drawerDirection.RIGHT ? 'from-right' : '']"
        [attr.data-vaul-drawer-direction]="direction()"
        [attr.data-vaul-isdragging]="isDragging()"
        [attr.data-state]="isOpen() ? 'open' : 'closed'"
        [draggable]="true"
        (dragstart)="$event.preventDefault()"
        (mousedown)="onDrag($event, drawer)"
        (mouseup)="onRelease($event, drawer, direction())"
        (pointermove)="onPointerMove($event, drawer)"
        (pointerout)="onPointerOut(drawer)"
        (pointerup)="onPointerUp($event, drawer)"
        (pointerdown)="onPointerDown($event, drawer)"
        (pointercancel)="onRelease($event, drawer, direction())"
        (contextmenu)="onContextMenu(drawer)"
      >
        <div class="drawer-content">
          <vaul-handle [drawerRef]="drawer">
            <div class="handle-indicator"></div>
          </vaul-handle>
          This is an example. It shout be injected
          <!-- <ng-content></ng-content> -->
        </div>
      </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .handle-indicator {
      background-color: rgb(212 212 216);
      width: 3rem;
      height: 0.375rem;
      border-radius: 9999px;
    }
    .drawer-content {
      margin: 0 auto 2rem auto;
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
  imports: [HandleComponent],
})
export class DrawerComponent implements AfterViewInit  {
  private readonly drawerService = inject(DrawerService);

  public fixed = input(true);
  public direction = input<DrawerDirectionType>(DrawerDirection.BOTTOM);
  public drawerDirection = DrawerDirection;
  public shouldScaleBackground = input(true);
  public dismissible = input(true);
  public removeDrawer = output<void>();
  public drawerRef = viewChild<ElementRef<HTMLDivElement>>('drawerRef');
  public isOpen = model<boolean>(false);
  public drawerHeight = model<string | null>(null);
  public initialDrawerHeightorWidth = model<number>(400);

  public isDragging = signal<boolean>(false);
  public isVerticalOrientation = computed<boolean>(() => isVertical(this.direction()));

  private dragStartTime = signal<Date | null>(null);
  private dragEndTime = signal<Date | null>(null);
  private pointerStartPosition: number | null = 0;
  private currentPosition = signal<number | null>(0);
  private drawerHeightRef = signal<number>(0);
  private drawerWidthRef = signal<number>(0);
  private justReleased = signal<boolean>(false);
  private wasBeyondThePoint = signal<boolean>(false);
  private isAllowedToDrag = signal<boolean>(true);
  private overlayRef = viewChild<ElementRef<HTMLDivElement>>('overlayRef');
  private keyboardIsOpen = signal(false);
  private previousDiffFromInitial = signal(0);
  private lastKnownPointerEventRef: PointerEvent | null = null;
  private shouldCancelInteraction: any;
  private preventCycle: boolean = false;
  private openTime: Date | null = null;
  private lastTimeDragPrevented: Date | null = null;
  constructor(@Inject(DOCUMENT) private document: Document) {}

  private onVisualViewportChange() {
    const drawer = this.drawerRef()?.nativeElement;
    if (!drawer) return;
    const focusedElement = this.document.activeElement as HTMLElement;
    if (isInput(focusedElement) || this.keyboardIsOpen()) {
      const visualViewportHeight = window.visualViewport?.height || 0;
      const totalHeight = window.innerHeight;
      // This is the height of the keyboard
      let diffFromInitial = totalHeight - visualViewportHeight;
      const drawerHeight = drawer.getBoundingClientRect().height || 0;
      // Adjust drawer height only if it's tall enough
      const isTallEnough = drawerHeight > totalHeight * 0.8;

      if (!this.initialDrawerHeightorWidth()) {
        this.initialDrawerHeightorWidth.set(drawerHeight);
      }
      const offsetFromTop = drawer.getBoundingClientRect().top;

      // visualViewport height may change due to somq e subtle changes to the keyboard. Checking if the height changed by 60 or more will make sure that they keyboard really changed its open state.
      if (Math.abs(this.previousDiffFromInitial() - diffFromInitial) > 60) {
        this.keyboardIsOpen.set(!this.keyboardIsOpen());
      }
      this.previousDiffFromInitial.set(diffFromInitial);
      // We don't have to change the height if the input is in view, when we are here we are in the opened keyboard state so we can correctly check if the input is in view
      if (drawerHeight > visualViewportHeight || this.keyboardIsOpen()) {
        const height = drawer.getBoundingClientRect().height;
        const width = drawer.getBoundingClientRect().width;
        let newDrawerHeight = height;
        let newDrawerWidth = width;
        if (this.isVerticalOrientation()) {
          if (height > visualViewportHeight) {
            newDrawerHeight = visualViewportHeight - (isTallEnough ? offsetFromTop : WINDOW_TOP_OFFSET);
          }
          // When fixed, don't move the drawer upwards if there's space, but rather only change it's height so it's fully scrollable when the keyboard is open
          if (this.fixed()) {
            drawer.style.height = `${height - Math.max(diffFromInitial, 0)}px`;
          } else {
            drawer.style.height = `${Math.max(newDrawerHeight, visualViewportHeight - offsetFromTop)}px`;
          }
        } else {
          if (width > visualViewportHeight) {
            newDrawerWidth = visualViewportHeight - (isTallEnough ? offsetFromTop : WINDOW_TOP_OFFSET);
          }
          // When fixed, don't move the drawer upwards if there's space, but rather only change it's height so it's fully scrollable when the keyboard is open
          if (this.fixed()) {
            drawer.style.height = `${height - Math.max(diffFromInitial, 0)}px`;
          } else {
            drawer.style.height = `${Math.max(newDrawerHeight, visualViewportHeight - offsetFromTop)}px`;
          }
        }
      } else if (!isMobileFirefox()) {
        drawer.style.height = `${this.initialDrawerHeightorWidth()}px`;
      }

      if (!this.keyboardIsOpen()) {
        drawer.style.bottom = `0px`;
      } else {
        // Negative bottom value would never make sense
        drawer.style.bottom = `${Math.max(diffFromInitial, 0)}px`;
      }
    }
  }

  public handleStartCycle(element: HTMLDivElement) {
    // Stop if this is the second click of a double click
    if (this.shouldCancelInteraction) {
      this.handleCancelInteraction();
      return;
    }
  }

  private handleStartInteraction() {
    requestTimeout(
      () => {
        this.shouldCancelInteraction = true;
      },
      LONG_PRESS_TIMEOUT,
      () => {},
    );
  }

  private handleCancelInteraction() {
    this.shouldCancelInteraction = false;
  }

  ngAfterViewInit() {
    this.openTime = new Date();
    window?.visualViewport?.addEventListener('resize', () => {
      this.onVisualViewportChange();
    });
    requestTimeout(() => {
      set(this.document.body,
        {
          transition: `transform ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
        },
        true
      );
      set(
        this.document.getElementById('wrapper'),
        {
          borderRadius: `8px`,
          transform: this.isVerticalOrientation()
            ? `scale(0.981)`
            : `scale(0.981)`,
          transition: `transform ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
        },
        true,
      ) 
    }, 10, () => {})
  }

  onPointerDown(event: PointerEvent, element: HTMLDivElement) {
    this.pointerStartPosition = this.isVerticalOrientation() ? event.pageY : event.pageX;
    this.handleStartInteraction();
    this.onPress(event);
  }

  onPointerUp(event: PointerEvent | MouseEvent, element: HTMLDivElement) {
    this.wasBeyondThePoint.set(false);
    this.onRelease(event, element, this.direction());
  }

  onPointerMove(event: PointerEvent, element: HTMLDivElement) {
    this.lastKnownPointerEventRef = event;
    if (!this.pointerStartPosition) return;
    const yPosition = event.pageY - (this.pointerStartPosition ?? 0);
    const xPosition = event.pageX - (this.pointerStartPosition ?? 0);
    const swipeStartThreshold: number = event.pointerType === 'touch' ? 10 : 2;
    const delta = { x: xPosition, y: yPosition };
    const direction = this.direction();
    const isAllowedToSwipe = this.isDeltaInDirection(delta, direction, swipeStartThreshold);
    // Check if the swipe is over the max height of the drawer
    if (isAllowedToSwipe) this.onDrag(event, element);
    else if (Math.abs(xPosition) > swipeStartThreshold || Math.abs(yPosition) > swipeStartThreshold) {
      this.pointerStartPosition = null;
    }
  }
  
  onPointerOut(element: HTMLDivElement) {
    this.handleOnPointerUp(this.lastKnownPointerEventRef, element, this.direction());
  }

  private isDeltaInDirection(delta: { x: number; y: number }, direction: DrawerDirectionType, threshold = 0) {
    if (this.wasBeyondThePoint()) return true;

    const deltaY = Math.abs(delta.y);
    const deltaX = Math.abs(delta.x);
    const isDeltaX = deltaX > deltaY;
    const dFactor = ['bottom', 'right'].includes(direction) ? 1 : -1;
    if (direction === 'right') {
      const isReverseDirection = delta.x * dFactor < 0;
      if (!isReverseDirection && deltaX >= 0 && deltaX <= threshold) {
        return !isDeltaX;
      }
    } else {
      const isReverseDirection = delta.y * dFactor < 0;
      if (!isReverseDirection && deltaY >= 0 && deltaY <= threshold) {
        return isDeltaX;
      }
    }

    this.wasBeyondThePoint.set(true);
    return true;
  }

  public onContextMenu(element: HTMLDivElement) {
    if (this.lastKnownPointerEventRef) {
      this.handleOnPointerUp(this.lastKnownPointerEventRef, element, this.direction());
    }
  }

  onPress(event: PointerEvent) {
    if (!this.dismissible()) return;
    if (this.drawerRef() && !this.drawerRef()?.nativeElement.contains(event.target as Node)) return;
    this.drawerHeightRef.set(this.drawerRef()?.nativeElement.getBoundingClientRect().height || 0);
    this.drawerWidthRef.set(this.drawerRef()?.nativeElement.getBoundingClientRect().width || 0);
    this.currentPosition.set(this.isVerticalOrientation() ? event.pageY : event.pageX);
    // iOS doesn't trigger mouseUp after scrolling so we need to listen to touched in order to disallow dragging
    if (isIOS()) {
      window.addEventListener('touchend', () => this.isAllowedToDrag.set(false), { once: true });
    }
    // Ensure we maintain correct pointer capture even when going outside of the drawer
    (event.target as HTMLElement).setPointerCapture(event.pointerId);

    this.pointerStartPosition = this.isVerticalOrientation() ? event.pageY : event.pageX;
    this.isDragging.set(true);
  }

  onDrag(event: MouseEvent, element: HTMLDivElement) {
    this.dragStartTime.set(new Date());
    event.preventDefault();
    if (!element) return;
    const dragPosition = this.direction() === 'bottom' ? event.pageY : event.pageX;
    if (this.isDragging()) {
      const directionMultiplier = this.direction() === 'bottom' || this.direction() === 'right' ? 1 : -1;
      let draggedDistance = (dragPosition - (this.pointerStartPosition ?? 0)) * directionMultiplier;
      const isDraggingInDirection = draggedDistance > 0; // We need to capture last time when drag with scroll was triggered and have a timeout between
      const absDraggedDistance = Math.abs(draggedDistance);
      const wrapper = this.document.getElementById('wrapper');
      const drawerDimension = this.isVerticalOrientation()
        ? element.getBoundingClientRect().height || 0
        : element.getBoundingClientRect().width || 0;
      // Calculate the percentage dragged, where 1 is the closed position
      let percentageDragged = absDraggedDistance / drawerDimension;
      if (!event.target) return;
      // TODO: Something wrong in this check
      // if (!this.drawerService.shouldDrag(element, isDraggingInDirection, this.direction())) return;
      element.classList.add(DRAG_CLASS);
      this.document.body.classList.add(BODY_DRAG_CLASS);

      // If shouldDrag gave true once after pressing down on the drawer, we set isAllowedToDrag to true and it will remain true until we let go, there's no reason to disable dragging mid way, ever, and that's the solution to it
      this.isAllowedToDrag.set(true);
      set(element, {
        transition: 'none',
      });
      set(this.overlayRef()?.nativeElement, {
        transition: 'none',
      });
      
      // TODO make is DraggingInDirection work. Now it gets false then true but does never enter this condition
      if (isDraggingInDirection) {
        // TODO: Find out why this does not work
        // const dampenedDraggedDistance = this.drawerService.dampenValue(absDraggedDistance);
        const translateValue = Math.max(draggedDistance, 0) * directionMultiplier;
        set(element, {
          transform: this.isVerticalOrientation()
            ? `translate3d(0, ${translateValue}px, 0)`
            : `translate3d(${translateValue}px, 0, 0)`,
        });
      const opacityValue = 1 - percentageDragged;
      set(
        this.overlayRef()?.nativeElement,
        {
          opacity: `${opacityValue}`,
          transition: 'none',
        },
        true,
      );
      console.log('scale wrapper',wrapper, this.overlayRef(), this.shouldScaleBackground())
      if (wrapper && this.overlayRef() && this.shouldScaleBackground()) {
        // Calculate percentageDragged as a fraction (0 to 1)
        const scale = this.drawerService.getScale();
        const scaleValue = Math.min(scale + percentageDragged * (1 - scale), 1);
        const borderRadiusValue = 8 - percentageDragged * 8;
        const translateValue = Math.max(0, 14 - percentageDragged * 14);
        console.log('scale wrapper', wrapper)
        set(
          wrapper,
          {
            borderRadius: `${borderRadiusValue}px`,
            transform: this.isVerticalOrientation()
              ? `scale(${scaleValue}) translate3d(0, ${translateValue}px, 0)`
              : `scale(${scaleValue}) translate3d(${translateValue}px, 0, 0)`,
            transition: 'none',
          },
          true,
        );
      }
       set(this.drawerRef()?.nativeElement, {
         transform: this.isVerticalOrientation()
           ? `translate3d(0, ${translateValue}px, 0)`
           : `translate3d(${translateValue}px, 0, 0)`,
       });
        return;
      }
    }
  }

  cancelDrag(element?: HTMLDivElement) {
    if (!this.isDragging() || !element) return;
    element.classList.remove(DRAG_CLASS);
    this.document.body.classList.remove(BODY_DRAG_CLASS);
    this.isAllowedToDrag.set(false);
    this.isDragging.set(false);
    if (!this.isDragging() || !element) return;
    this.dragEndTime.set(new Date());
  }

  onRelease(event: PointerEvent | MouseEvent, element: HTMLDivElement | undefined, direction: DrawerDirectionType) {
    if (!element || !this.isDragging()) return;
    element.classList.remove(DRAG_CLASS);
    this.document.body.classList.remove(BODY_DRAG_CLASS);
    this.isDragging.set(false);
    this.isAllowedToDrag.set(false);
    if (!event || !event?.target) return;
    this.dragEndTime.set(new Date());
    const swipeAmount = this.drawerService.getTranslate(element, this.direction());
    if (
      !event ||
      !swipeAmount ||
      Number.isNaN(swipeAmount)
    ) {
      return;
    }
    if (this.dragStartTime() === null) return;
    const timeTaken = (this.dragEndTime()?.getTime() || 0) - (this.dragStartTime()?.getTime() || 0);
    const distMoved = (isVertical(direction) ? event.pageY : event.pageX) - (this.pointerStartPosition || 0);
    const velocity = Math.abs(distMoved) / timeTaken;
    if (velocity > 0.05) {
      // `justReleased` is needed to prevent the drawer from focusing on an input when the drag ends, as it's not the intent most of the time.
      setTimeout(() => {
        this.justReleased.set(false);
      }, 200);
    }
    // Moved upwards, don't do anything
    const isGoingOppositeDirection = (event.pageY - (this.pointerStartPosition || 0) < 0) && (event.pageX - (this.pointerStartPosition || 0) < 0);
    if ((direction === DrawerDirection.BOTTOM || direction === DrawerDirection.RIGHT) && isGoingOppositeDirection) {
      this.resetDrawer(direction, element);
      return;
    }
    if (velocity > VELOCITY_THRESHOLD) {
      this.closeDrawer(element);
      return;
    }
    const visibleDrawerHeight = Math.min(element?.getBoundingClientRect().height ?? 0, window.innerHeight);
    const visibleDrawerWidth = Math.min(element?.getBoundingClientRect().width ?? 0, window.innerWidth);
    const isHorizontalSwipe = direction === 'right';
    if (Math.abs(swipeAmount) >= (isHorizontalSwipe ? visibleDrawerWidth : visibleDrawerHeight) * CLOSE_THRESHOLD) {
      this.closeDrawer(element);
      return;
    }
    this.resetDrawer(direction, element);
  }

  private resetDrawer(direction: DrawerDirectionType, element: HTMLDivElement) {
    if (!element) return;
    const wrapper = this.document.querySelector('.data-vaul-drawer-wrapper');
    const currentSwipeAmount = this.drawerService.getTranslate(element, this.direction());
    set(element, {
      transform: 'scale(1) translate3d(0, 0, 0)',
      transition: `transform ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
    });
  
    set(this.overlayRef()?.nativeElement, {
      transition: `opacity ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
      opacity: '1',
    });
    // Don't reset background if swiped upwards
    if (this.shouldScaleBackground() && currentSwipeAmount && currentSwipeAmount < 0 && this.isOpen()) {
      set(
        wrapper,
        {
          borderRadius: `${BORDER_RADIUS}px`,
          overflow: 'hidden',
          ...(isVertical(direction)
            ? {
                transform: `scale(${this.drawerService.getScale()}) translate3d(0, calc(env(safe-area-inset-top) + 14px), 0)`,
                transformOrigin: 'top',
              }
            : {
                transform: `scale(${this.drawerService.getScale()}) translate3d(calc(env(safe-area-inset-top) + 14px), 0, 0)`,
                transformOrigin: 'left',
              }),
          transformOrigin: this.isVerticalOrientation() ? 'top' : 'left',
          transitionProperty: 'transform, border-radius',
          transitionDuration: `${TRANSITIONS.DURATION}s`,
          transitionTimingFunction: `cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
        },
        true,
      );
    }
  }

  public closeDrawer(drawer?: HTMLDivElement) {
    if (!drawer && this.drawerRef()) return;
    this.cancelDrag();
    this.isOpen.set(false);
    this.resetStylesWrapper();
    this.removeDrawer.emit();
  }
  public resetStylesWrapper() {
    set(this.document.body,
      {
       'background-color': 'transparent',
        transformOrigin: this.isVerticalOrientation() ? 'top' : 'left',
        transitionProperty: 'transform, border-radius',
        transitionDuration: `${TRANSITIONS.DURATION}s`,
        transitionTimingFunction: `cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
      },
      true
    );
    set(this.document.getElementById('wrapper'),
      {
        transform: 'scale(1)',
        transition: `transform ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
      },
      true
    );

  }
  private handleOnPointerUp(event: PointerEvent | null, element: HTMLDivElement, direction: DrawerDirectionType) {
    if (!event) return;
    this.pointerStartPosition = null;
    this.wasBeyondThePoint.set(false);
    this.onRelease(event, element, direction);
  }
  
  shouldDrag(el: EventTarget, isDraggingInDirection: boolean, direction: DrawerDirectionType) {
    let element = el as HTMLElement;
    const drawer = element;
    const highlightedText = window.getSelection()?.toString();
    const swipeAmount = drawer ? this.drawerService.getTranslate(drawer, direction) : null;
    const date = new Date();
    // Fixes https://github.com/emilkowalski/vaul/issues/483
    if (element.tagName === 'SELECT') {
      return false;
    }

    if (element.hasAttribute('data-vaul-no-drag') || element.closest('[data-vaul-no-drag]')) {
      return false;
    }
    // Allow scrolling when animating
    if (this.openTime && date.getTime() - this.openTime?.getTime() < 500) {
      return false;
    }

    if (swipeAmount !== null) {
      if (direction === 'bottom' ? swipeAmount > 0 : swipeAmount < 0) {
        return true;
      }
    }

    // Don't drag if there's highlighted text
    if (highlightedText && highlightedText.length > 0) {
      return false;
    }

    // Disallow dragging if drawer was scrolled within `scrollLockTimeout`
    if (
      this.lastTimeDragPrevented &&
      date.getTime() - this.lastTimeDragPrevented.getTime() < SCROLL_LOCK_TIMEOUT &&
      swipeAmount === 0
    ) {
      this.lastTimeDragPrevented = date;
      return false;
    }

    if (isDraggingInDirection) {
      this.lastTimeDragPrevented = date;

      // We are dragging down so we should allow scrolling
      return false;
    }

    // Keep climbing up the DOM tree as long as there's a parent
    while (element) {
      // Check if the element is scrollable
      if (element.scrollHeight > element.clientHeight) {
        if (element.scrollTop !== 0) {
          this.lastTimeDragPrevented = new Date();

          // The element is scrollable and not scrolled to the top, so don't drag
          return false;
        }

        if (element.getAttribute('role') === 'dialog') {
          return true;
        }
      }

      // Move up to the parent element
      element = element.parentNode as HTMLElement;
    }

    // No scrollable parents not scrolled to the top found, so drag
    return true;
  }
}

//   private updateDrawerTransform(drawer: HTMLElement, direction: DrawerDirectionType) {
//     const offset = isVertical(direction)
//       ? drawer?.getBoundingClientRect().width
//       : drawer?.getBoundingClientRect().height;

//     // Get current drag state
//     const dragDelta = this.isDragging() ? this.calculateDragDelta() : 0;
//     const finalOffset = offset + dragDelta;
//     const transform = isVertical(direction)
//       ? `translateY(${finalOffset - offset}px)`
//       : `translateX(${finalOffset - offset}px)`;
//     set(drawer, {
//       transition: this.isDragging()
//         ? 'none'
//         : `transform ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
//       transform,
//     });
//   }
// }
