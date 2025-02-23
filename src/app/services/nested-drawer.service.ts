import { Injectable, inject } from '@angular/core';
import { Subject, combineLatest, map, take, takeUntil } from 'rxjs';
import { NESTED_DISPLACEMENT, TRANSITIONS } from './constants';
import { DrawerService } from './drawer.service';
import { isVertical, set } from './helpers';

@Injectable({
  providedIn: 'root'
})
export class NestedDrawerService {
  private readonly drawerService = inject(DrawerService);
  private readonly destroy$ = new Subject<void>();
  private nestedOpenChangeTimer: number | null = null;

  constructor() {
    // Subscribe to drawer ref changes
    this.drawerService.drawerRef$
      .pipe(takeUntil(this.destroy$))
      .subscribe(drawer => {
        if (!drawer) return;
        this.setupDrawerTransforms(drawer);
      });
  }

  onNestedOpenChange(open: boolean) {
    combineLatest([
      this.drawerService.drawerRef$,
      this.drawerService.direction$
    ]).pipe(
      map(([drawer, direction]) => {
        if (!drawer) return;

        const scale = open ? (window.innerWidth - NESTED_DISPLACEMENT) / window.innerWidth : 1;
        const initialTranslate = open ? -NESTED_DISPLACEMENT : 0;

        if (this.nestedOpenChangeTimer) {
          window.clearTimeout(this.nestedOpenChangeTimer);
        }

        set(drawer, {
          transition: `transform ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
          transform: isVertical(direction)
            ? `scale(${scale}) translate3d(0, ${initialTranslate}px, 0)`
            : `scale(${scale}) translate3d(${initialTranslate}px, 0, 0)`
        });

        if (!open) {
          this.nestedOpenChangeTimer = window.setTimeout(() => {
            // Get current transform value
            this.getTranslate(drawer).pipe(
              map(translateValue => {
                set(drawer, {
                  transition: 'none',
                  transform: isVertical(direction)
                    ? `translate3d(0, ${translateValue}px, 0)`
                    : `translate3d(${translateValue}px, 0, 0)`
                });
              }),
              take(1)
            ).subscribe();
          }, 500);
        }
      }),
      take(1)
    ).subscribe();
  }

  onNestedDrag(percentageDragged: number) {
    combineLatest([
      this.drawerService.drawerRef$,
      this.drawerService.direction$
    ]).pipe(
      map(([drawer, direction]) => {
        if (!drawer || percentageDragged < 0) return;

        const initialScale = (window.innerWidth - NESTED_DISPLACEMENT) / window.innerWidth;
        const newScale = initialScale + percentageDragged * (1 - initialScale);
        const newTranslate = -NESTED_DISPLACEMENT + percentageDragged * NESTED_DISPLACEMENT;

        set(drawer, {
          transform: isVertical(direction)
            ? `scale(${newScale}) translate3d(0, ${newTranslate}px, 0)`
            : `scale(${newScale}) translate3d(${newTranslate}px, 0, 0)`,
          transition: 'none'
        });
      }),
      take(1)
    ).subscribe();
  }

  private getTranslate(element: HTMLElement) {
    return this.drawerService.direction$.pipe(
      map(direction => {
        const style = window.getComputedStyle(element);
        const transform = style.transform;
        if (transform === 'none') return 0;

        const matrix = transform.match(/matrix.*\((.+)\)/)?.[1].split(', ');
        if (!matrix) return 0;

        return isVertical(direction)
          ? parseFloat(matrix[5]) || 0  // Y transform
          : parseFloat(matrix[4]) || 0;  // X transform
      })
    );
  }

  private setupDrawerTransforms(drawer: HTMLElement) {
    this.drawerService.direction$.pipe(
      map(direction => {
        set(drawer, {
          transformOrigin: isVertical(direction) ? 'top' : 'left',
          transition: `transform ${TRANSITIONS.DURATION}s cubic-bezier(${TRANSITIONS.EASE.join(',')})`
        });
      }),
      take(1)
    ).subscribe();
  }

  ngOnDestroy() {
    if (this.nestedOpenChangeTimer) {
      window.clearTimeout(this.nestedOpenChangeTimer);
    }
    this.destroy$.next();
    this.destroy$.complete();
  }
} 