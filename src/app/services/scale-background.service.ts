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
  private readonly destroy$ = new Subject<void>();
  public timeoutId: number | null = null;
  public initialBackgroundColor = new BehaviorSubject<string>(
    typeof document !== 'undefined' ? document.body.style.backgroundColor : '',
  );

  getScale(): number {
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
