import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, EMPTY, Subject, combineLatest, map, of, switchMap, take, takeUntil } from 'rxjs';
import { DrawerDirection } from '../types';
import { TRANSITIONS } from './constants';
import { isVertical, set } from './helpers';
import { SnapPointsService } from './snap-points.service';

@Injectable({
  providedIn: 'root'
})
export class DrawerService {
  snapPointsService = inject(SnapPointsService);
  private destroy$ = new Subject<void>();
  private stateChange$ = new BehaviorSubject<void>(undefined);
  
  // Core state subjects
  private readonly isOpenSubject = new BehaviorSubject<boolean>(false);
  private readonly isDraggingSubject = new BehaviorSubject<boolean>(false);
  private readonly drawerRefSubject = new BehaviorSubject<HTMLElement | null>(null);
  private readonly overlayRefSubject = new BehaviorSubject<HTMLElement | null>(null);
  private readonly directionSubject = new BehaviorSubject<DrawerDirection>('bottom');
  private dragStartPositionSubject = new BehaviorSubject<{ x: number, y: number } | null>(null);
  private shouldScaleBackgroundSubject = new BehaviorSubject<boolean>(false);
  private setBackgroundColorOnScaleSubject = new BehaviorSubject<boolean>(false);
  private noBodyStylesSubject = new BehaviorSubject<boolean>(false);
  private nestedSubject = new BehaviorSubject<boolean>(false);
  private modalSubject = new BehaviorSubject<boolean>(false);
  private hasBeenOpenedSubject = new BehaviorSubject<boolean>(false);
  private preventScrollRestorationSubject = new BehaviorSubject<boolean>(false);
  private currentPointerPositionSubject = new BehaviorSubject<{ x: number, y: number } | null>(null);

  // Public observables
  readonly isOpen$ = this.isOpenSubject.asObservable();
  readonly isDragging$ = this.isDraggingSubject.asObservable();
  readonly direction$ = this.directionSubject.asObservable();
  readonly drawerRef$ = this.drawerRefSubject.asObservable();
  readonly overlayRef$ = this.overlayRefSubject.asObservable();
  readonly shouldScaleBackground$ = this.shouldScaleBackgroundSubject.asObservable();
  readonly setBackgroundColorOnScale$ = this.setBackgroundColorOnScaleSubject.asObservable();
  readonly noBodyStyles$ = this.noBodyStylesSubject.asObservable();
  readonly nested$ = this.nestedSubject.asObservable();
  readonly modal$ = this.modalSubject.asObservable();
  readonly hasBeenOpened$ = this.hasBeenOpenedSubject.asObservable();
  // Computed observable that combines drawer and snap point state
  drawerTransform$ = combineLatest([
    this.drawerRefSubject,
    this.isDraggingSubject,
    this.snapPointsService.activeSnapPoint$
  ]).pipe(
    map(([drawer, isDragging, snapPointOffset]) => {
      if (!drawer) return null;
      if (snapPointOffset === null) {
        snapPointOffset = 0;
      };
      const offset = isDragging 
        ? snapPointOffset + this.calculateDragDelta()
        : snapPointOffset;
      return isVertical(this.directionSubject.value)
        ? `translateY(${offset}px)`
        : `translateX(${offset}px)`;
    })
  );

  constructor() {
    // Subscribe to state changes
    this.stateChange$
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        const drawer = this.drawerRefSubject.value;
        if (!drawer) return;

        // Only update transform if drawer is open
        if (this.isOpenSubject.value) {
          this.updateDrawerTransform(drawer);
        }
      });

    // Subscribe to drawer ref changes
    this.drawerRefSubject
      .pipe(takeUntil(this.destroy$))
      .subscribe(drawer => {
        if (!drawer) return;
        if (!this.isOpenSubject.value) {
          const height = drawer.getBoundingClientRect().height;
          drawer.style.transform = `translateY(${height}px)`;
        }
      });

    // Subscribe to active snap point changes
    this.snapPointsService.activeSnapPoint$
      .pipe(takeUntil(this.destroy$))
      .subscribe(snapPointOffset => {
        const drawer = this.drawerRefSubject.value;
        if (!drawer || !snapPointOffset) return;

        const transform = isVertical(this.directionSubject.value)
          ? `translateY(${snapPointOffset}px)`
          : `translateX(${snapPointOffset}px)`;

        drawer.style.transform = transform;
        drawer.style.transition = this.isDraggingSubject.value ? 'none' : 
          `transform ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`;
      });

    // Subscribe to drag state changes
    this.isDraggingSubject.pipe(
      takeUntil(this.destroy$),
      switchMap(isDragging => {
        const drawer = this.drawerRefSubject.value;
        if (!drawer || !isDragging) return EMPTY;

        return combineLatest([
          of(drawer),
          this.currentPointerPositionSubject,
          this.snapPointsService.activeSnapPoint$
        ]).pipe(
          map(([drawer, currentPosition, snapPointOffset]) => {
            if (!currentPosition || snapPointOffset === null) return;
            const dragDelta = this.calculateDragDelta();
            if(dragDelta <= 0) {
              return;
            }
            const transform = isVertical(this.directionSubject.value)
              ? `translateY(${snapPointOffset + dragDelta}px)`
              : `translateX(${snapPointOffset + dragDelta}px)`;

            drawer.style.transform = transform;
            drawer.style.transition = 'none';
          })
        );
      })
    ).subscribe();

    // Watch for open state changes
    this.isOpenSubject
      .pipe(takeUntil(this.destroy$))
      .subscribe(isOpen => {
        if (isOpen) {
          this.snapPointsService.snapPoints$.pipe(
            take(1)
          ).subscribe(points => {
            if (points?.length) {
              this.snapPointsService.setActiveSnapPoint(points[0]);
            }
          });
        } else {
          this.snapPointsService.setActiveSnapPoint(null);
          const drawer = this.drawerRefSubject.value;
          if (drawer) {
            const height = drawer.getBoundingClientRect().height;
            drawer.style.transform = `translateY(${height}px)`;
          }
        }
      });
  }

  // State updaters
  setIsOpen(isOpen: boolean) {
    if (isOpen === this.isOpenSubject.value) return;
    
    this.isOpenSubject.next(isOpen);
    if (isOpen) {
      this.hasBeenOpenedSubject.next(true);
    }
    this.stateChange$.next();
  }

  private updateDrawerTransform(drawer: HTMLElement) {
    // Get the active snap point
    this.snapPointsService.activeSnapPoint$.pipe(
      map(snapPointOffset => {
        const offset = snapPointOffset === null 
          ? drawer?.getBoundingClientRect().height || 0 
          : snapPointOffset;

        // Get current drag state
        const isDragging = this.isDraggingSubject.value;
        const dragDelta = isDragging ? this.calculateDragDelta() : 0;
        const finalOffset = offset + dragDelta;

        const transform = isVertical(this.directionSubject.value)
          ? `translateY(${finalOffset}px)`
          : `translateX(${finalOffset}px)`;

        set(drawer, {
          transition: isDragging ? 'none' : 
            `transform ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
          transform
        });
      }),
      take(1)
    ).subscribe();
  }

  setIsDragging(isDragging: boolean) {
    this.isDraggingSubject.next(isDragging);
    this.stateChange$.next();
  }

  setDirection(direction: DrawerDirection) {
    this.directionSubject.next(direction);
    this.snapPointsService.setDirection(direction);
    this.stateChange$.next();
  }

  setDrawerRef(ref: HTMLElement | null) {
    if (ref) {
      // Set initial transform to hide drawer
      const height = ref.getBoundingClientRect().height;
      ref.style.transform = `translateY(${height}px)`;
    }
    
    this.drawerRefSubject.next(ref);
    this.snapPointsService.setRefs(ref, this.overlayRefSubject.value);
    this.stateChange$.next();
  }

  setOverlayRef(ref: HTMLElement | null) {
    this.overlayRefSubject.next(ref);
    this.snapPointsService.setRefs(this.drawerRefSubject.value, ref);
    this.stateChange$.next();
  }

  // Expose observables
  snapPointsOffset$ = this.snapPointsService.snapPointsOffset$;
  activeSnapPoint$ = this.snapPointsService.activeSnapPoint$;

  // Event handlers
  onPress(event: PointerEvent) {
    if (!this.drawerRefSubject.value) return;
    
    this.isDraggingSubject.next(true);
    this.dragStartPositionSubject.next({
      x: event.clientX,
      y: event.clientY
    });
    this.currentPointerPositionSubject.next({
      x: event.clientX,
      y: event.clientY
    });
  }

  onRelease(event: PointerEvent | null) {
    if (!event || !this.isDraggingSubject.value) return;

    const velocity = this.calculateVelocity(event);
    const dragDelta = this.calculateDragDelta();
    if(dragDelta <= 0) {
      return;
    }
    // Coordinate release behavior with snap points
    this.snapPointsService.onRelease({
      draggedDistance: dragDelta,
      velocity,
      closeDrawer: () => {
        this.isOpenSubject.next(false);
        this.snapPointsService.setActiveSnapPoint(null);
      },
      dismissible: true
    });

    this.isDraggingSubject.next(false);
    this.dragStartPositionSubject.next(null);
  }

  onDrag(event: PointerEvent) {
    if (!this.drawerRefSubject.value || !this.isDraggingSubject.value) return;
    
    this.currentPointerPositionSubject.next({
      x: event.clientX,
      y: event.clientY
    });

    const dragDelta = this.calculateDragDelta();
    const drawer = this.drawerRefSubject.value;
    const currentTransform = dragDelta;
    if(dragDelta <=0) {
      return;
    }
    // Apply transform directly
    drawer.style.transform = `translateY(${currentTransform}px)`;
    drawer.style.transition = 'none';
    this.snapPointsService.onDrag({
      draggedDistance: dragDelta,
      currentOffset: currentTransform
    });
  }

  closeDrawer() {
    this.setIsOpen(false);
  }

  setSnapPoints(points: number[] | undefined) {
    this.snapPointsService.setSnapPoints(points);
  }

  private calculateDragDelta(): number {
    const start = this.dragStartPositionSubject.value;
    const current = this.currentPointerPositionSubject.value;
    if (!start || !current) return 0;

    return isVertical(this.directionSubject.value)
      ? current.y - start.y
      : current.x - start.x;
  }

  private calculateVelocity(event: PointerEvent): number {
    const start = this.dragStartPositionSubject.value;
    if (!start) return 0;

    const deltaY = event.clientY - start.y;
    const deltaTime = event.timeStamp - event.timeStamp; // Need to store start time
    return Math.abs(deltaY / deltaTime);
  }

  shouldScaleBackground() {
    return this.shouldScaleBackgroundSubject.value;
  }

  setBackgroundColorOnScale() {
    return this.setBackgroundColorOnScaleSubject.value;
  }

  noBodyStyles() {
    return this.noBodyStylesSubject.value;
  }

  setScaleBackground(value: boolean) {
    this.shouldScaleBackgroundSubject.next(value);
  }

  setBackgroundColor(value: boolean) {
    this.setBackgroundColorOnScaleSubject.next(value);
  }

  setNoBodyStyles(value: boolean) {
    this.noBodyStylesSubject.next(value);
  }

  // Add getters
  nested() {
    return this.nestedSubject.value;
  }

  modal() {
    return this.modalSubject.value;
  }

  hasBeenOpened() {
    return this.hasBeenOpenedSubject.value;
  }

  preventScrollRestoration() {
    return this.preventScrollRestorationSubject.value;
  }

  // Add setters
  setNested(value: boolean) {
    this.nestedSubject.next(value);
  }

  setModal(value: boolean) {
    this.modalSubject.next(value);
  }

  setHasBeenOpened(value: boolean) {
    this.hasBeenOpenedSubject.next(value);
  }

  setPreventScrollRestoration(value: boolean) {
    this.preventScrollRestorationSubject.next(value);
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.isOpenSubject.complete();
    this.isDraggingSubject.complete();
    this.drawerRefSubject.complete();
    this.overlayRefSubject.complete();
    this.directionSubject.complete();
    this.dragStartPositionSubject.complete();
    this.shouldScaleBackgroundSubject.complete();
    this.setBackgroundColorOnScaleSubject.complete();
    this.noBodyStylesSubject.complete();
    this.nestedSubject.complete();
    this.modalSubject.complete();
    this.hasBeenOpenedSubject.complete();
    this.preventScrollRestorationSubject.complete();
    this.currentPointerPositionSubject.complete();
  }
} 