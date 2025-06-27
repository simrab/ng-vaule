import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject, takeUntil } from 'rxjs';
import { DrawerDirection, DrawerDirectionType } from '../types';
import {
  BORDER_RADIUS,
  CLOSE_THRESHOLD,
  SCROLL_LOCK_TIMEOUT,
  TRANSITIONS,
  VELOCITY_THRESHOLD,
  WINDOW_TOP_OFFSET
} from './constants';
import { isVertical, set } from './helpers';

@Injectable({
  providedIn: 'root',
})
export class DrawerService {
  private destroy$ = new Subject<void>();
  public isOpen$ = new BehaviorSubject<boolean>(false);
  public isDragging$ = new BehaviorSubject<boolean>(false);
  public isDraggingObs$ = this.isDragging$.asObservable();
  public drawerRef$ = new BehaviorSubject<HTMLDivElement | null>(null);
  public drawerRefObs$ = this.drawerRef$.asObservable();
  public overlayRef$ = new BehaviorSubject<HTMLElement | null>(null);
  public direction$ = new BehaviorSubject<DrawerDirectionType>(DrawerDirection.BOTTOM);
  public dragStartPosition$ = new BehaviorSubject<{ y: number } | null>(null);
  public shouldScaleBackground$ = new BehaviorSubject<boolean>(false);
  private currentPointerPosition$ = new BehaviorSubject<{ y: number } | null>(null);
  public currentPointerPositionObs$: Observable<{ y: number } | null> = this.currentPointerPosition$.asObservable();
  private lastTimeDragPrevented: Date | null = null;

  constructor() {
    this.drawerRefObs$.pipe(takeUntil(this.destroy$)).subscribe(() => {});
    this.isDragging$
      .asObservable()
      .pipe(takeUntil(this.destroy$))
      .subscribe();
  }

  setIsDragging(isDragging: boolean) {
    this.isDragging$.next(isDragging);
  }

  setDirection(direction: DrawerDirectionType) {
    this.direction$.next(direction);
  }

  setDrawerRef(ref: HTMLDivElement | null) {
    if (ref) {
      const height = ref.getBoundingClientRect().height;
      const width = ref.getBoundingClientRect().width;
      ref.style.transform = isVertical(this.direction$.value) ? `translateY(${height}px)` : `translateX(${width}px)`;
    }
    this.drawerRef$.next(ref);
  }

  setOverlayRef(ref: HTMLElement | null) {
    this.overlayRef$.next(ref);
  }

  onPress(event: PointerEvent, element?: HTMLDivElement) {
    if (!element) return;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    this.isDragging$.next(true);
    this.dragStartPosition$.next({ y: event.clientY });
    this.currentPointerPosition$.next({ y: event.clientY });
  }

  onRelease(
    event: PointerEvent | null,
    direction: DrawerDirectionType,
    element?: HTMLDivElement,
    starterPosition?: number,
    dragStartTime?: Date,
    dragEndTime?: Date,
  ) {
    if (!element) return;
    if (!event || !this.isDragging$.value) return;
    const timeTaken = (dragEndTime?.getTime() || 0) - (dragStartTime?.getTime() || 0);
    const distMoved = (starterPosition || 0) - (isVertical(direction) ? event.pageY : event.pageX);
    const velocity = Math.abs(distMoved) / timeTaken;
    const dragDelta = this.calculateDragDelta();
    const swipeAmount = this.getTranslate(element, direction);
    if (dragDelta <= 0) {
      return;
    }
    if (direction === DrawerDirection.BOTTOM || direction === DrawerDirection.RIGHT ? distMoved > 0 : distMoved < 0) {
      this.resetDrawer(direction, element);
      return;
    }
    if (velocity > VELOCITY_THRESHOLD) {
      this.closeDrawer(element);
      return;
    }
    const visibleDrawerHeight = Math.min(element?.getBoundingClientRect().height ?? 0, window.innerHeight);
    const visibleDrawerWidth = Math.min(element?.getBoundingClientRect().width ?? 0, window.innerWidth);
    if (
      Math.abs(swipeAmount || 0) >=
      (isVertical(direction) ? visibleDrawerHeight : visibleDrawerWidth) * CLOSE_THRESHOLD
    ) {
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
          transformOrigin: isVertical(direction) ? 'top' : 'left',
          transitionProperty: 'transform, border-radius',
          transitionDuration: `${TRANSITIONS.DURATION}s`,
          transitionTimingFunction: `cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
        },
        true,
      );
    }
  }

  shouldDrag(el: EventTarget, isDraggingInDirection: boolean, direction: DrawerDirectionType) {
    let element = el as HTMLElement;
    const drawer = this.drawerRef$.value;
    const highlightedText = window.getSelection()?.toString();
    const swipeAmount = drawer ? this.getTranslate(drawer, direction) : null;
    const date = new Date();
    if (element.tagName === 'SELECT') {
      return false;
    }
    if (element.hasAttribute('data-vaul-no-drag') || element.closest('[data-vaul-no-drag]')) {
      return false;
    }
    if (swipeAmount !== null) {
      if (direction === 'bottom' ? swipeAmount > 0 : swipeAmount < 0) {
        return true;
      }
    }
    if (highlightedText && highlightedText.length > 0) {
      return false;
    }
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
      return false;
    }
    while (element) {
      if (element.scrollHeight > element.clientHeight) {
        if (element.scrollTop !== 0) {
          this.lastTimeDragPrevented = new Date();
          return false;
        }
        if (element.getAttribute('role') === 'dialog') {
          return true;
        }
      }
      element = element.parentNode as HTMLElement;
    }
    return true;
  }

  closeDrawer(drawer: HTMLDivElement) {
    if (!drawer) return;
    this.isDragging$.next(false);
    this.isOpen$.next(false);
    set(drawer, {
      transform: isVertical(this.direction$.value)
        ? `translateY(${window.innerHeight}px)`
        : `translateX(${window.innerWidth}px)`,
      transition: `transform ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
    });
  }

  getScale() {
    return (window.innerWidth - WINDOW_TOP_OFFSET) / window.innerWidth;
  }

  public calculateDragDelta(startPoint?: number, currentPoint?: number): number {
    const start = startPoint ?? this.dragStartPosition$.value?.y;
    const current = currentPoint ?? this.currentPointerPosition$.value?.y;
    if (!start || !current) return 0;
    return current - start;
  }

  public getTranslate(element: HTMLElement, direction: DrawerDirectionType) {
    if (!element) {
      return null;
    }
    const style = window.getComputedStyle(element);
    const transform =
      style.transform || style.webkitTransform;
    let mat = transform.match(/^matrix3d\((.+)\)$/);
    if (mat) {
      return parseFloat(mat[1].split(', ')[13]);
    }
    mat = transform.match(/^matrix\((.+)\)$/);
    return mat ? parseFloat(mat[1].split(', ')[isVertical(direction) ? 5 : 4]) : null;
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
    this.currentPointerPosition$.complete();
  }
}
