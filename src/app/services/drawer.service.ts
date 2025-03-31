import { Injectable } from '@angular/core';
import { BehaviorSubject, EMPTY, Observable, Subject, combineLatest, map, of, switchMap, takeUntil } from 'rxjs';
import { DrawerDirection, DrawerDirectionType } from '../types';
import {
  BORDER_RADIUS,
  CLOSE_THRESHOLD,
  DRAG_CLASS,
  SCROLL_LOCK_TIMEOUT,
  TRANSITIONS,
  VELOCITY_THRESHOLD,
  WINDOW_TOP_OFFSET,
} from './constants';
import { isVertical, set } from './helpers';

@Injectable({
  providedIn: 'root',
})
export class DrawerService {
  private destroy$ = new Subject<void>();
  // Excerpt from: class DrawerService
  public stateChange$ = new BehaviorSubject<void>(undefined);

  // Core state subjects
  public isOpen$ = new BehaviorSubject<boolean>(false);
  public isDragging$ = new BehaviorSubject<boolean>(false);
  public isDraggingObs$ = this.isDragging$.asObservable();
  public drawerRef$ = new BehaviorSubject<HTMLDivElement | null>(null);
  public drawerRefObs$ = this.drawerRef$.asObservable();
  public overlayRef$ = new BehaviorSubject<HTMLElement | null>(null);
  public direction$ = new BehaviorSubject<DrawerDirectionType>(DrawerDirection.BOTTOM);
  public dragStartPosition$ = new BehaviorSubject<{ y: number } | null>(null);
  public shouldScaleBackground$ = new BehaviorSubject<boolean>(false);
  public setBackgroundColorOnScale$ = new BehaviorSubject<boolean>(false);
  public noBodyStyles$ = new BehaviorSubject<boolean>(false);
  public nested$ = new BehaviorSubject<boolean>(false);
  public modal$ = new BehaviorSubject<boolean>(false);
  public hasBeenOpened$ = new BehaviorSubject<boolean>(false);
  public preventScrollRestoration$ = new BehaviorSubject<boolean>(false);
  private currentPointerPosition$ = new BehaviorSubject<{ y: number } | null>(null);
  public currentPointerPositionObs$: Observable<{ y: number } | null> = this.currentPointerPosition$.asObservable();

  public wasBeyondThePoint$ = new BehaviorSubject<boolean | null>(null);
  public pointerStart$ = new BehaviorSubject<{ x?: number; y?: number } | null>(null);
  public dragEndTime$ = new BehaviorSubject<Date | null>(null);
  public dragStartTime$ = new BehaviorSubject<Date | null>(null);
  public drawerHeight$ = new BehaviorSubject<number | null>(null);
  public isAllowedToDrag$ = new BehaviorSubject<boolean>(false);
  public openTime$ = new BehaviorSubject<Date | null>(null);

  private lastTimeDragPrevented: Date | null = null;

  drawerTransform$ = combineLatest([this.drawerRefObs$, this.isDraggingObs$]).pipe(
    map(([drawer, isDragging]) => {
      if (!drawer) return null;
      const offset = isDragging ? this.calculateDragDelta() : 0;
      return `translateY(${offset}px)`;
    }),
  );
  constructor() {
    // Subscribe to state changes
    this.stateChange$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      const drawer = this.drawerRef$.value;
      if (!drawer) return;

      if (this.isOpen$.value) {
        this.updateDrawerTransform(drawer);
      }
    });

    // Subscribe to drawer ref changes
    this.drawerRefObs$.pipe(takeUntil(this.destroy$)).subscribe((drawer: HTMLDivElement | null) => {
      if (!drawer) return;
      if (!this.isOpen$.value) {
        const height = drawer.getBoundingClientRect().height;
        drawer.style.transform = `translateY(${height}px)`;
      }
    });

    // Subscribe to drag state changes
    this.isDragging$
      .asObservable()
      .pipe(
        takeUntil(this.destroy$),
        switchMap((isDragging) => {
          const drawer = this.drawerRef$.value;
          if (!drawer || !isDragging) return EMPTY;

          return combineLatest([of(drawer), this.currentPointerPositionObs$]).pipe(
            map(([drawer, currentPosition]) => {
              if (!currentPosition) return;
              const dragDelta = this.calculateDragDelta();
              if (dragDelta <= 0) {
                return;
              }
              // const transform = `translateY(${dragDelta}px)`;

              // drawer.style.transform = transform;
              drawer.style.transition = 'none';
            }),
          );
        }),
      )
      .subscribe();

    // Watch for open state changes
    this.isOpen$.pipe(takeUntil(this.destroy$)).subscribe((isOpen: boolean) => {
      if (!isOpen) {
        const drawer = this.drawerRef$.value;
        if (drawer) {
          const height = drawer.getBoundingClientRect().height;
          drawer.style.transform = `translateY(${height}px)`;
        }
      }
    });
  }

  // State updaters
  setIsOpen(isOpen: boolean) {
    if (isOpen === this.isOpen$.value) return;

    this.isOpen$.next(isOpen);
    if (isOpen) {
      this.hasBeenOpened$.next(true);
    }
    this.stateChange$.next();
  }

  private updateDrawerTransform(drawer: HTMLElement) {
    const offset = drawer?.getBoundingClientRect().height || 0;

    // Get current drag state
    const isDragging = this.isDragging$.value;
    const dragDelta = isDragging ? this.calculateDragDelta() : 0;
    const finalOffset = offset + dragDelta;

    const transform = `translateY(${finalOffset - offset}px)`;

    set(drawer, {
      transition: isDragging
        ? 'none'
        : `transform ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
      transform,
    });
  }

  setIsDragging(isDragging: boolean) {
    this.isDragging$.next(isDragging);
    this.stateChange$.next();
  }

  setDirection(direction: DrawerDirectionType) {
    this.direction$.next(direction);
    this.stateChange$.next();
  }

  setDrawerRef(ref: HTMLDivElement | null) {
    if (ref) {
      // Set initial transform to hide drawer
      const height = ref.getBoundingClientRect().height;
      ref.style.transform = `translateY(${height}px)`;
    }

    this.drawerRef$.next(ref);
    this.stateChange$.next();
  }

  setOverlayRef(ref: HTMLElement | null) {
    this.overlayRef$.next(ref);
    this.stateChange$.next();
  }

  onPress(event: PointerEvent, element?: HTMLDivElement) {
    if (!element) return;
    // Ensure we maintain correct pointer capture even when going outside of the drawer
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    this.isDragging$.next(true);
    this.dragStartPosition$.next({
      y: event.clientY,
    });
    this.currentPointerPosition$.next({
      y: event.clientY,
    });
  }

  onRelease(event: PointerEvent | null, direction: DrawerDirectionType, element?: HTMLDivElement) {
    if (!element) return;
    if (!event || !this.isDragging$.value) return;
    this.dragEndTime$.next(new Date());

    const timeTaken = (this.dragEndTime$.value?.getTime() || 0) - (this.dragStartTime$.value?.getTime() || 0);
    const distMoved = (this.pointerStart$?.value?.y || 0) - (isVertical(direction) ? event.pageY : event.pageX);
    const velocity = Math.abs(distMoved) / timeTaken;
    const dragDelta = this.calculateDragDelta();
    const swipeAmount = this.getTranslate(element, this.direction$.value);

    if (dragDelta <= 0) {
      return;
    }

    if (this.direction$.value === 'bottom' ? distMoved > 0 : distMoved < 0) {
      this.resetDrawer(direction, element);
      return;
    }
    // Coordinate release behavior with snap points
    if (velocity > VELOCITY_THRESHOLD) {
      this.closeDrawer(element);
      return;
    }
    const visibleDrawerHeight = Math.min(element?.getBoundingClientRect().height ?? 0, window.innerHeight);
    if (Math.abs(swipeAmount || 0) >= visibleDrawerHeight * CLOSE_THRESHOLD) {
      this.closeDrawer(element);
      this.isDragging$.next(false);
      this.dragStartPosition$.next(null);
      return;
    }
    this.resetDrawer(direction, element);
  }
  resetDrawer(direction: DrawerDirectionType, element?: HTMLDivElement) {
    if (!element) return;
    const wrapper = document.querySelector('[data-vaul-drawer-wrapper]');
    const currentSwipeAmount = this.getTranslate(element, this.direction$.value);

    set(element, {
      transform: 'translate3d(0, 0, 0)',
      transition: `transform ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
    });

    set(this.overlayRef$.value, {
      transition: `opacity ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
      opacity: '1',
    });

    // Don't reset background if swiped upwards
    if (this.shouldScaleBackground$.value && currentSwipeAmount && currentSwipeAmount > 0 && this.isOpen$.value) {
      set(
        wrapper,
        {
          borderRadius: `${BORDER_RADIUS}px`,
          overflow: 'hidden',
          ...(isVertical(direction)
            ? {
                transform: `scale(${this.getScale()}) translate3d(0, calc(env(safe-area-inset-top) + 14px), 0)`,
                transformOrigin: 'top',
              }
            : {
                transform: `scale(${this.getScale()}) translate3d(calc(env(safe-area-inset-top) + 14px), 0, 0)`,
                transformOrigin: 'left',
              }),
          transformOrigin: 'top',
          transitionProperty: 'transform, border-radius',
          transitionDuration: `${TRANSITIONS.DURATION}s`,
          transitionTimingFunction: `cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
        },
        true,
      );
    }
  }
  onDrag(event: DragEvent | PointerEvent, element?: HTMLDivElement, dismissible: boolean = true) {
    const direction = this.direction$.value;

    if (!element) return;
    // We need to know how much of the drawer has been dragged in percentages so that we can transform background accordingly
    if (this.isDragging$.value) {
      const directionMultiplier = direction === 'bottom' ? 1 : -1;
      const pointerStartY = this.pointerStart$?.value?.y ?? 0;
      const pointerStartX = this.pointerStart$?.value?.x ?? 0;
      const draggedDistance = (isVertical(direction) ? pointerStartY - event.pageY : pointerStartX - event.pageX) * directionMultiplier;
      const isDraggingInDirection = draggedDistance > 0;

      // Pre condition for disallowing dragging in the close direction.
      const noCloseSnapPointsPreCondition = !dismissible && !isDraggingInDirection;

      // Disallow dragging down to close when first snap point is the active one and dismissible prop is set to false.
      if (noCloseSnapPointsPreCondition) return;

      // We need to capture last time when drag with scroll was triggered and have a timeout between
      const absDraggedDistance = Math.abs(draggedDistance);
      const wrapper = document.querySelector('[data-vaul-drawer-wrapper]');
      const drawerDimension = this.drawerHeight$.value ?? 0;

      // Calculate the percentage dragged, where 1 is the closed position
      let percentageDragged = absDraggedDistance / drawerDimension;

      // Disallow close dragging beyond the smallest snap point.
      if (noCloseSnapPointsPreCondition && percentageDragged >= 1) {
        return;
      }
      if (!event.target) return;
      if (!this.isAllowedToDrag$.value && !this.shouldDrag(event.target, isDraggingInDirection)) return;
      element.classList.add(DRAG_CLASS);
      // If shouldDrag gave true once after pressing down on the drawer, we set isAllowedToDrag to true and it will remain true until we let go, there's no reason to disable dragging mid way, ever, and that's the solution to it
      this.isAllowedToDrag$.next(true);
      set(element, {
        transition: 'none',
      });

      set(this.overlayRef$.value, {
        transition: 'none',
      });

      // Run this only if snapPoints are not defined or if we are at the last snap point (highest one)
      if (isDraggingInDirection) {
        const dampenedDraggedDistance = this.dampenValue(draggedDistance);

        const translateValue = Math.min(dampenedDraggedDistance * -1, 0) * directionMultiplier;
        set(element, {
          transform: isVertical(direction) ? `translate3d(0, ${translateValue}px, 0)` : `translate3d(${translateValue}px, 0, 0)`,
        });
        return;
      }

      const opacityValue = 1 - percentageDragged;

      if (wrapper && this.overlayRef$.value) {
        // Calculate percentageDragged as a fraction (0 to 1)
        const scaleValue = Math.min(this.getScale() + percentageDragged * (1 - this.getScale()), 1);
        const borderRadiusValue = 8 - percentageDragged * 8;

        const translateValue = Math.max(0, 14 - percentageDragged * 14);

        set(
          wrapper,
          {
            borderRadius: `${borderRadiusValue}px`,
            transform: `scale(${scaleValue}) translate3d(0, ${translateValue}px, 0)`,
            transition: 'none',
          },
          true,
        );
      }

      const translateValue = absDraggedDistance * directionMultiplier;

      set(element, {
        transform: `translate3d(0, ${translateValue}px, 0)`,
      });

      this.currentPointerPosition$.next({
        y: event.clientY,
      });

      const dragDelta = this.calculateDragDelta();
      const currentTransform = dragDelta;
      if (dragDelta <= 0) {
        return;
      }
      // Apply transform directly
      element.style.transform = `translateY(${currentTransform}px)`;
      element.style.transition = 'none';
    }
  }
  shouldDrag(el: EventTarget, isDraggingInDirection: boolean) {
    let direction = this.direction$.value;
    let element = el as HTMLElement;
    const drawer = this.drawerRef$.value;
    const highlightedText = window.getSelection()?.toString();
    const swipeAmount = drawer ? this.getTranslate(drawer, direction) : null;
    const date = new Date();
    // Fixes https://github.com/emilkowalski/vaul/issues/483
    if (element.tagName === 'SELECT') {
      return false;
    }

    if (element.hasAttribute('data-vaul-no-drag') || element.closest('[data-vaul-no-drag]')) {
      return false;
    }
    // Allow scrolling when animating
    if (this.openTime$.value && date.getTime() - this.openTime$.value.getTime() < 500) {
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
  closeDrawer(drawer: HTMLDivElement) {
    if (!drawer) return;
    this.cancelDrag(drawer);
    this.isOpen$.next(false);
    // Animate to bottom of screen
    set(drawer, {
      transform: `translateY(${window.innerHeight}px)`,
      transition: `transform ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
    });

    // Wait for animation to complete before setting isOpen to false
    // setTimeout(() => {
    //   this.setIsOpen(false);
    //   set(drawer, {
    //     transform: 'none',
    //     transition: 'none',
    //   });
    // }, TRANSITIONS.DURATION * 1000);
  }

  getScale() {
    return (window.innerWidth - WINDOW_TOP_OFFSET) / window.innerWidth;
  }

  private calculateDragDelta(): number {
    const start = this.dragStartPosition$.value;
    const current = this.currentPointerPosition$.value;
    if (!start || !current) return 0;

    return current.y - start.y;
  }

  shouldScaleBackground() {
    return this.shouldScaleBackground$.value;
  }

  setBackgroundColorOnScale() {
    return this.setBackgroundColorOnScale$.value;
  }

  noBodyStyles() {
    return this.noBodyStyles$.value;
  }

  setScaleBackground(value: boolean) {
    this.shouldScaleBackground$.next(value);
  }

  setBackgroundColor(value: boolean) {
    this.setBackgroundColorOnScale$.next(value);
  }

  setNoBodyStyles(value: boolean) {
    this.noBodyStyles$.next(value);
  }

  // Add getters
  nested() {
    return this.nested$.value;
  }

  modal() {
    return this.modal$.value;
  }

  hasBeenOpened() {
    return this.hasBeenOpened$.value;
  }

  preventScrollRestoration() {
    return this.preventScrollRestoration$.value;
  }

  // Add setters
  setNested(value: boolean) {
    this.nested$.next(value);
  }

  setModal(value: boolean) {
    this.modal$.next(value);
  }

  setHasBeenOpened(value: boolean) {
    this.hasBeenOpened$.next(value);
  }

  setPreventScrollRestoration(value: boolean) {
    this.preventScrollRestoration$.next(value);
  }

  private cancelDrag(element: HTMLDivElement) {
    if (!this.isDragging$.value || !element) return;

    element.classList.remove(DRAG_CLASS);
    this.isDragging$.next(false);
    this.dragEndTime$.next(new Date());
  }

  private getTranslate(element: HTMLElement, direction: DrawerDirectionType) {
    if (!element) {
      return null;
    }
    const style = window.getComputedStyle(element);
    const transform =
      // @ts-ignore
      style.transform || style.webkitTransform || style.mozTransform;
    let mat = transform.match(/^matrix3d\((.+)\)$/);
    if (mat) {
      // https://developer.mozilla.org/en-US/docs/Web/CSS/transform-function/matrix3d
      return parseFloat(mat[1].split(', ')[13]);
    }
    // https://developer.mozilla.org/en-US/docs/Web/CSS/transform-function/matrix
    mat = transform.match(/^matrix\((.+)\)$/);
    return mat ? parseFloat(mat[1].split(', ')[5]) : null;
  }

  dampenValue(v: number) {
    return 8 * (Math.log(v + 1) - 2);
  }

  assignStyle(element: HTMLElement | null | undefined, style: Partial<CSSStyleDeclaration>) {
    if (!element) return () => {};

    const prevStyle = element.style.cssText;
    Object.assign(element.style, style);

    return () => {
      element.style.cssText = prevStyle;
    };
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.isOpen$.complete();
    this.isDragging$.complete();
    this.drawerRef$.complete();
    this.overlayRef$.complete();
    this.direction$.complete();
    this.dragStartPosition$.complete();
    this.shouldScaleBackground$.complete();
    this.setBackgroundColorOnScale$.complete();
    this.noBodyStyles$.complete();
    this.nested$.complete();
    this.modal$.complete();
    this.hasBeenOpened$.complete();
    this.preventScrollRestoration$.complete();
    this.currentPointerPosition$.complete();
  }
}
