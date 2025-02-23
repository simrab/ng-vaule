import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Subject, combineLatest, map, takeUntil } from 'rxjs';
import { isSafari } from './browser';
import { DrawerService } from './drawer.service';

let previousBodyPosition: Record<string, string> | null = null;

interface DrawerState {
  isOpen: boolean;
  nested: boolean;
  hasBeenOpened: boolean;
  modal: boolean;
  noBodyStyles: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class PositionFixedService {
  private readonly drawerService = inject(DrawerService);
  private readonly destroy$ = new Subject<void>();
  private readonly activeUrl = new BehaviorSubject<string>(
    typeof window !== 'undefined' ? window.location.href : ''
  );

  constructor() {
    // Subscribe to drawer state changes
    combineLatest([
      this.drawerService.isOpen$,
      this.drawerService.nested$,
      this.drawerService.hasBeenOpened$,
      this.drawerService.modal$,
      this.drawerService.noBodyStyles$
    ]).pipe(
      map(([isOpen, nested, hasBeenOpened, modal, noBodyStyles]): DrawerState => ({
        isOpen,
        nested,
        hasBeenOpened,
        modal,
        noBodyStyles
      })),
      takeUntil(this.destroy$)
    ).subscribe(state => {
      if (!state.nested && state.hasBeenOpened) {
        if (state.isOpen) {
          // avoid for standalone mode (PWA)
          const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
          if (!isStandalone) {
            this.setPositionFixed(state.noBodyStyles);
          }

          if (!state.modal) {
            window.setTimeout(() => {
              this.restorePositionSetting();
            }, 500);
          }
        } else {
          this.restorePositionSetting();
        }
      }
    });

    // Track URL changes
    if (typeof window !== 'undefined') {
      const observer = new MutationObserver(() => {
        this.activeUrl.next(window.location.href);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  setPositionFixed(noBodyStyles: boolean) {
    // If previousBodyPosition is already set, don't set it again
    if (previousBodyPosition === null && !noBodyStyles) {
      previousBodyPosition = {
        position: document.body.style.position,
        top: document.body.style.top,
        left: document.body.style.left,
        height: document.body.style.height,
        right: 'unset',
      };

      // Update the dom inside an animation frame
      const { scrollX, innerHeight } = window;
      const currentScrollPos = window.scrollY;

      document.body.style.setProperty('position', 'fixed', 'important');
      Object.assign(document.body.style, {
        top: `${-currentScrollPos}px`,
        left: `${-scrollX}px`,
        right: '0px',
        height: 'auto',
      });

      window.setTimeout(
        () =>
          window.requestAnimationFrame(() => {
            // Attempt to check if the bottom bar appeared due to the position change
            const bottomBarHeight = innerHeight - window.innerHeight;
            if (bottomBarHeight && currentScrollPos >= innerHeight) {
              // Move the content further up so that the bottom bar doesn't hide it
              document.body.style.top = `${-(currentScrollPos + bottomBarHeight)}px`;
            }
          }),
        300,
      );
    }
  }

  private restorePositionSetting() {
    // All browsers on iOS will return true here
    if (!isSafari()) return;

    if (previousBodyPosition !== null) {
      // Convert the position from "px" to Int
      const y = -parseInt(document.body.style.top, 10);
      const x = -parseInt(document.body.style.left, 10);

      // Restore styles
      Object.assign(document.body.style, previousBodyPosition);

      window.requestAnimationFrame(() => {
        const currentUrl = this.activeUrl.getValue();
        if (this.drawerService.preventScrollRestoration() && 
            currentUrl !== window.location.href) {
          this.activeUrl.next(window.location.href);
          return;
        }

        window.scrollTo(x, y);
      });

      previousBodyPosition = null;
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.activeUrl.complete();
  }
} 