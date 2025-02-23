import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject, combineLatest, map, take } from 'rxjs';
import { DrawerDirection } from '../types';
import { TRANSITIONS, VELOCITY_THRESHOLD } from './constants';
import { isVertical, set } from './helpers';

export interface DragEvent {
  draggedDistance: number;
  currentOffset: number;
}

@Injectable({
  providedIn: 'root'
})
export class SnapPointsService {
  private readonly destroy = new Subject<void>();

  // Core state subjects - now expecting pixel values
  private readonly snapPoints = new BehaviorSubject<number[] | undefined>(undefined);
  private readonly activeSnapPoint = new BehaviorSubject<number | null>(null);
  private readonly fadeFromIndex = new BehaviorSubject<number | undefined>(undefined);
  private readonly direction = new BehaviorSubject<DrawerDirection>('bottom');
  private readonly drawerRef = new BehaviorSubject<HTMLElement | null>(null);
  private readonly overlayRef = new BehaviorSubject<HTMLElement | null>(null);
  private readonly containerSize = new BehaviorSubject<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0
  });

  // Expose observables
  readonly snapPoints$ = this.snapPoints.asObservable();
  readonly activeSnapPoint$ = this.activeSnapPoint.asObservable();
  readonly direction$ = this.direction.asObservable();

  readonly activeSnapPointIndex$ = this.snapPoints.pipe(
    map(points => {
      const active = this.activeSnapPoint.value;
      return points?.findIndex(point => point === active) ?? null;
    })
  );

  readonly snapPointsOffset$ = this.snapPoints.pipe(
    map(points => {
      if (!points) return [];

      const size = this.containerSize.value;
      const direction = this.direction.value;
      const drawerRef = this.drawerRef.value;
      const drawerHeight = drawerRef?.getBoundingClientRect().height || 0;

      // If no active point, return height to keep drawer hidden
      if (this.activeSnapPoint.value === null) {
        return [drawerHeight];
      }

      return points.map(point => {
        if (direction === 'bottom') {
          return point * (size.height - drawerHeight);
        }
        return point;
      });
    })
  );

  readonly shouldFade$ = this.snapPoints.pipe(
    map(points => {
      const fadeIndex = this.fadeFromIndex.value;
      const active = this.activeSnapPoint.value;
      return Boolean(
        points?.length && 
        (fadeIndex !== undefined) && 
        points[fadeIndex] === active
      ) || !points;
    })
  );

  constructor() {
    if (typeof window !== 'undefined') {
      const handleResize = () => {
        this.containerSize.next({
          width: window.innerWidth,
          height: window.innerHeight
        });
      };

      window.addEventListener('resize', handleResize);
      this.destroy.subscribe(() => {
        window.removeEventListener('resize', handleResize);
      });
    }
  }

  setSnapPoints(points: number[] | undefined) {
    this.snapPoints.next(points);
    if (points?.length) {
      this.activeSnapPoint.next(points[0]);
    }
  }

  setActiveSnapPoint(point: number | null) {
    this.activeSnapPoint.next(point);
  }

  setDirection(dir: DrawerDirection) {
    this.direction.next(dir);
  }

  setRefs(drawer: HTMLElement | null, overlay: HTMLElement | null) {
    this.drawerRef.next(drawer);
    this.overlayRef.next(overlay);
  }

  snapToPoint(dimension: number) {
    this.snapPointsOffset$.pipe(
      map(offset => {
        const drawer = this.drawerRef.value;
        const overlay = this.overlayRef.value;
        const points = this.snapPoints.value;
        const direction = this.direction.value;
        
        if (!drawer || !points || !offset?.length) return;

        const newSnapPointIndex = offset.findIndex((snapPointDim: number) => snapPointDim === dimension);
        if (newSnapPointIndex === -1) return;

        // Prevent negative translations
        const safeTranslation = Math.max(0, dimension);

        // Update drawer position
        set(drawer, {
          transition: `transform ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
          transform: isVertical(direction) ? 
            `translate3d(0, ${safeTranslation}px, 0)` : 
            `translate3d(${safeTranslation}px, 0, 0)`
        });

        // Update overlay opacity if needed
        if (overlay) {
          const fadeIndex = this.fadeFromIndex.value;
          const shouldUpdateOverlay = fadeIndex !== undefined && 
            newSnapPointIndex !== offset.length - 1 && 
            newSnapPointIndex !== fadeIndex && 
            newSnapPointIndex < fadeIndex;

          set(overlay, {
            transition: `opacity ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
            opacity: shouldUpdateOverlay ? '0' : '1'
          });
        }

        this.setActiveSnapPoint(points[Math.max(newSnapPointIndex, 0)]);
      }),
      take(1)
    ).subscribe();
  }

  onRelease(params: {
    draggedDistance: number;
    closeDrawer: () => void;
    velocity: number;
    dismissible: boolean;
  }) {
    const { draggedDistance, closeDrawer, velocity, dismissible } = params;

    combineLatest([
      this.activeSnapPointIndex$,
      this.snapPointsOffset$
    ]).pipe(
      map(([activeIndex, offset]) => {
        if (activeIndex === null || !offset?.length) return;
        
        const direction = this.direction.value;
        const currentPosition = (direction === 'bottom' || direction === 'right') ? 
          (offset[activeIndex] ?? 0) - draggedDistance :
          (offset[activeIndex] ?? 0) + draggedDistance;

        // Handle velocity-based snapping
        if (velocity > VELOCITY_THRESHOLD) {
          debugger;
          const hasDraggedUp = draggedDistance < 0;
          if (hasDraggedUp) {
            this.snapToPoint(offset[offset.length - 1]);
          } else if (dismissible) {
            debugger;
            closeDrawer();
          } else {
            this.snapToPoint(offset[0]);
          }
          return;
        }

        // Find closest snap point
        const closestSnapPoint = offset.reduce((prev: number, curr: number) => {
          return Math.abs(curr - currentPosition) < Math.abs(prev - currentPosition) ? 
            curr : prev;
        });

        this.snapToPoint(closestSnapPoint);
      }),
      take(1)
    ).subscribe();
  }

  onDrag(event: DragEvent) {
    const { draggedDistance } = event;
    
    combineLatest([
      this.activeSnapPointIndex$,
      this.snapPointsOffset$
    ]).pipe(
      map(([activeIndex, offset]) => {
        if (activeIndex === null || !offset?.length) return;
        
        const direction = this.direction.value;
        const activeSnapPointOffset = offset[activeIndex];
        
        // Calculate new position based on direction
        const newValue = (direction === 'bottom' || direction === 'right')
          ? activeSnapPointOffset - draggedDistance
          : activeSnapPointOffset + draggedDistance;

        // Prevent negative translations and don't exceed snap points
        if ((direction === 'bottom' || direction === 'right')) {
          if (newValue < 0 || newValue < offset[offset.length - 1]) {
            return;
          }
        }
        if ((direction === 'top' || direction === 'left')) {
          if (newValue < 0 || newValue > offset[offset.length - 1]) {
            return;
          }
        }

        // Update drawer position
        const drawer = this.drawerRef.value;
        if (!drawer) return;

        set(drawer, {
          transform: isVertical(direction) 
            ? `translate3d(0, ${newValue}px, 0)` 
            : `translate3d(${newValue}px, 0, 0)`
        });
      }),
      take(1) // Take only first emission
    ).subscribe();
  }

  ngOnDestroy() {
    this.destroy.next();
    this.destroy.complete();
    this.snapPoints.complete();
    this.activeSnapPoint.complete();
    this.fadeFromIndex.complete();
    this.direction.complete();
    this.drawerRef.complete();
    this.overlayRef.complete();
    this.containerSize.complete();
  }
} 