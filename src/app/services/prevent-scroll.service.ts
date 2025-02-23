import { Injectable, inject } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { isIOS } from './browser';
import { DrawerService } from './drawer.service';

const KEYBOARD_BUFFER = 24;

// HTML input types that do not cause the software keyboard to appear
const nonTextInputTypes = new Set([
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

@Injectable({
  providedIn: 'root'
})
export class PreventScrollService {
  private readonly drawerService = inject(DrawerService);
  private readonly destroy$ = new Subject<void>();
  private preventScrollCount = 0;
  private restore: (() => void) | undefined;
  private readonly visualViewport = typeof window !== 'undefined' ? window.visualViewport : null;

  constructor() {
    // Watch for drawer open state changes
    this.drawerService.isOpen$
      .pipe(takeUntil(this.destroy$))
      .subscribe(isOpen => {
        const isDisabled = !isOpen;
        
        if (isDisabled) {
          return;
        }

        const documentElement = document.documentElement;
        const documentBody = document.body;

        if (this.preventScrollCount++ > 0) {
          return;
        }

        const scrollbarWidth = window.innerWidth - documentElement.clientWidth;

        // Handle iOS specific scroll prevention
        if (isIOS()) {
          const scrollY = window.scrollY;
          const fill = scrollbarWidth > 0;
          const elementToPrevent = documentBody;

          elementToPrevent.style.position = 'fixed';
          elementToPrevent.style.overflow = 'hidden';
          elementToPrevent.style.width = '100%';
          elementToPrevent.style.top = `-${scrollY}px`;
          elementToPrevent.style.paddingRight = fill ? `${scrollbarWidth}px` : '';

          this.restore = () => {
            elementToPrevent.style.position = '';
            elementToPrevent.style.overflow = '';
            elementToPrevent.style.width = '';
            elementToPrevent.style.top = '';
            elementToPrevent.style.paddingRight = '';
            window.scrollTo(0, scrollY);
          };

          return;
        }

        // Handle other browsers
        const target = documentElement;
        const { scrollbarGutter } = getComputedStyle(target);
        const hasScrollbarGutter = scrollbarGutter === 'stable';
        const fill = scrollbarWidth > 0 && !hasScrollbarGutter;

        target.style.overflow = 'hidden';
        if (fill) {
          target.style.paddingRight = `${scrollbarWidth}px`;
        }

        this.restore = () => {
          target.style.overflow = '';
          if (fill) {
            target.style.paddingRight = '';
          }
        };
      });
  }

  ngOnDestroy() {
    if (this.preventScrollCount > 0 && this.restore) {
      this.restore();
      this.restore = undefined;
    }
    this.destroy$.next();
    this.destroy$.complete();
  }

  private isScrollable(node: Element): boolean {
    const style = window.getComputedStyle(node);
    return /(auto|scroll)/.test(style.overflow + style.overflowX + style.overflowY);
  }

  private getScrollParent(node: Element): Element {
    if (this.isScrollable(node)) {
      node = node.parentElement as HTMLElement;
    }

    while (node && !this.isScrollable(node)) {
      node = node.parentElement as HTMLElement;
    }

    return node || document.scrollingElement || document.documentElement;
  }

  private isInput(target: Element): boolean {
    return (
      (target instanceof HTMLInputElement && !nonTextInputTypes.has(target.type)) ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }

  private preventScrollMobileSafari() {
    let scrollable: Element;
    let lastY = 0;

    const onTouchStart = (e: TouchEvent) => {
      scrollable = this.getScrollParent(e.target as Element);
      if (scrollable === document.documentElement && scrollable === document.body) {
        return;
      }
      lastY = e.changedTouches[0].pageY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!scrollable || scrollable === document.documentElement || scrollable === document.body) {
        e.preventDefault();
        return;
      }

      const y = e.changedTouches[0].pageY;
      const scrollTop = scrollable.scrollTop;
      const bottom = scrollable.scrollHeight - scrollable.clientHeight;

      if (bottom === 0) return;

      if ((scrollTop <= 0 && y > lastY) || (scrollTop >= bottom && y < lastY)) {
        e.preventDefault();
      }

      lastY = y;
    };

    const onTouchEnd = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (this.isInput(target) && target !== document.activeElement) {
        e.preventDefault();
        target.style.transform = 'translateY(-2000px)';
        target.focus();
        requestAnimationFrame(() => {
          target.style.transform = '';
        });
      }
    };

    const onFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (this.isInput(target)) {
        target.style.transform = 'translateY(-2000px)';
        requestAnimationFrame(() => {
          target.style.transform = '';

          if (this.visualViewport) {
            if (this.visualViewport.height < window.innerHeight) {
              requestAnimationFrame(() => {
                this.scrollIntoView(target);
              });
            } else {
              this.visualViewport.addEventListener('resize', () => this.scrollIntoView(target), { once: true });
            }
          }
        });
      }
    };

    const onWindowScroll = () => {
      window.scrollTo(0, 0);
    };

    // Record initial scroll position
    const scrollX = window.pageXOffset;
    const scrollY = window.pageYOffset;

    const restoreStyles = this.chain(
      this.setStyle(document.documentElement, 'paddingRight', `${window.innerWidth - document.documentElement.clientWidth}px`)
    );

    // Scroll to top
    window.scrollTo(0, 0);

    const removeEvents = this.chain(
      this.addEvent(document, 'touchstart', onTouchStart, { passive: false, capture: true }),
      this.addEvent(document, 'touchmove', onTouchMove, { passive: false, capture: true }),
      this.addEvent(document, 'touchend', onTouchEnd, { passive: false, capture: true }),
      this.addEvent(document, 'focus', onFocus, true),
      this.addEvent(window, 'scroll', onWindowScroll)
    );

    return () => {
      restoreStyles();
      removeEvents();
      window.scrollTo(scrollX, scrollY);
    };
  }

  private scrollIntoView(target: Element) {
    const root = document.scrollingElement || document.documentElement;
    while (target && target !== root) {
      const scrollable = this.getScrollParent(target);
      if (scrollable !== document.documentElement && scrollable !== document.body && scrollable !== target) {
        const scrollableTop = scrollable.getBoundingClientRect().top;
        const targetTop = target.getBoundingClientRect().top;
        const targetBottom = target.getBoundingClientRect().bottom;
        const keyboardHeight = scrollable.getBoundingClientRect().bottom + KEYBOARD_BUFFER;

        if (targetBottom > keyboardHeight) {
          scrollable.scrollTop += targetTop - scrollableTop;
        }
      }
      target = scrollable.parentElement as Element;
    }
  }

  private setStyle(element: HTMLElement, style: string, value: string) {
    const cur = element.style[style as any];
    element.style[style as any] = value;
    return () => {
      element.style[style as any] = cur;
    };
  }

  private addEvent<K extends keyof GlobalEventHandlersEventMap>(
    target: EventTarget,
    event: K,
    handler: (this: Document, ev: GlobalEventHandlersEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions
  ) {
    target.addEventListener(event, handler as EventListener, options);
    return () => {
      target.removeEventListener(event, handler as EventListener, options);
    };
  }

  private chain(...callbacks: Array<() => void>): () => void {
    return () => {
      callbacks.forEach(callback => {
        if (typeof callback === 'function') {
          callback();
        }
      });
    };
  }
} 