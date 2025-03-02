import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Subject, combineLatest, takeUntil } from 'rxjs';
import { BORDER_RADIUS, TRANSITIONS, WINDOW_TOP_OFFSET } from './constants';
import { DrawerService } from './drawer.service';
import { assignStyle, chain } from './helpers';

const noop = () => () => {};

@Injectable({
  providedIn: 'root',
})
export class ScaleBackgroundService {
  private readonly drawerService = inject(DrawerService);
  private readonly destroy$ = new Subject<void>();
  private timeoutId: number | null = null;
  private readonly initialBackgroundColor = new BehaviorSubject<string>(
    typeof document !== 'undefined' ? document.body.style.backgroundColor : '',
  );

  constructor() {
    // Subscribe to drawer state changes
    combineLatest({
      isOpen: this.drawerService.isOpen$,
      shouldScale: this.drawerService.shouldScaleBackground$,
      direction: this.drawerService.direction$,
      setBackgroundColor: this.drawerService.setBackgroundColorOnScale$,
      noBodyStyles: this.drawerService.noBodyStyles$,
    })
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        if (state.isOpen && state.shouldScale) {
          if (this.timeoutId) {
            clearTimeout(this.timeoutId);
          }

          const wrapper =
            (document.querySelector('[data-vaul-drawer-wrapper]') as HTMLElement) ||
            (document.querySelector('[vaul-drawer-wrapper]') as HTMLElement);

          if (!wrapper) return;
          chain(
            state.setBackgroundColor && !state.noBodyStyles
              ? assignStyle(document.body, { background: 'black' })
              : noop,
            assignStyle(wrapper, {
              transformOrigin: 'top',
              transitionProperty: 'transform, border-radius',
              transitionDuration: `${TRANSITIONS.DURATION}s`,
              transitionTimingFunction: `cubic-bezier(${TRANSITIONS.EASE.join(',')})`,
            }),
          );

          const wrapperStylesCleanup = assignStyle(wrapper, {
            borderRadius: `${BORDER_RADIUS}px`,
            overflow: 'hidden',
            transform: `scale(${this.getScale()}) translate3d(0, calc(env(safe-area-inset-top) + 14px), 0)`,
          });

          // Cleanup function
          return () => {
            wrapperStylesCleanup();
            this.timeoutId = window.setTimeout(() => {
              const initialBg = this.initialBackgroundColor.value;
              if (initialBg) {
                document.body.style.background = initialBg;
              } else {
                document.body.style.removeProperty('background');
              }
            }, TRANSITIONS.DURATION * 1000);
          };
        }
        return null;
      });
  }

  private getScale(): number {
    return (window.innerWidth - WINDOW_TOP_OFFSET) / window.innerWidth;
  }

  ngOnDestroy() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    this.destroy$.next();
    this.destroy$.complete();
    this.initialBackgroundColor.complete();
  }
}
