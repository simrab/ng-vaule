import { AsyncPipe } from '@angular/common';
import { AfterViewInit, ChangeDetectionStrategy, Component, effect, ElementRef, inject, input, OnDestroy, output, signal, viewChild } from '@angular/core';
import { Subject } from 'rxjs';
import { DrawerService } from './services/drawer.service';
import { DrawerDirection } from './types';

@Component({
  selector: 'vaul-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div 
      class="vaul-drawer"
      #drawerRef
      [attr.data-vaul-drawer]=""
      [attr.data-vaul-drawer-direction]="direction()"
      [attr.data-state]="(isOpen$| async) ? 'open' : 'closed'"
      [attr.data-vaul-snap-points]="!!snapPoints() ? 'true' : 'false'"
      [style.height]="drawerHeight()"
      (pointerdown)="onPress($event)"
      (pointermove)="onDrag($event)"
      (pointerup)="onRelease($event)"
      (pointercancel)="onRelease($event)">
      <ng-content></ng-content>
    </div>
  `,
  styles: [`
    :host {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: var(--vaul-drawer-z-index, 999);
      display: flex;
      flex-direction: column;
      pointer-events: none;
      transform-origin: bottom center;
      height: 100%;
    }

    .vaul-drawer {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      width: 100%;
      height: auto;
      overflow: hidden;
      pointer-events: auto;
      background: white;
      border-radius: 8px 8px 0 0;
      will-change: transform;
      transform-origin: bottom center;
    }

  `],
  imports: [AsyncPipe]
})
export class DrawerComponent implements AfterViewInit, OnDestroy {
  private readonly drawerService = inject(DrawerService);
  private readonly destroy$ = new Subject<void>();

  readonly open = input(false);
  readonly direction = input<DrawerDirection>('bottom');
  readonly shouldScaleBackground = input(false);
  readonly dismissible = input(true);
  readonly modal = input(true);
  readonly nested = input(false);
  readonly repositionInputs = input(true);
  readonly autoFocus = input(false);
  readonly snapPoints = input<number[] | undefined>(undefined);

  readonly openChange = output<boolean>();
  
  drawerRef = viewChild<ElementRef<HTMLDivElement>>('drawerRef');

  private readonly initialDrawerHeight = signal<number | null>(null);
  private readonly keyboardIsOpen = signal(false);
  private readonly previousDiffFromInitial = signal(0);
  readonly drawerHeight = signal<string | null>(null);

  readonly isOpen$ = this.drawerService.isOpen$;

  constructor() {
    // Watch open state
    effect(() => {
      const isOpen = this.open();
      this.drawerService.setIsOpen(isOpen);
    });

    // Watch other inputs
    effect(() => {
      this.drawerService.setDirection(this.direction());
      this.drawerService.setScaleBackground(this.shouldScaleBackground());
      this.drawerService.setModal(this.modal());
      this.drawerService.setNested(this.nested());
    });

    // Watch snap points
    effect(() => {
      if (this.snapPoints()) {
        this.drawerService.setSnapPoints(this.snapPoints());
      }
    });

    // Setup visual viewport handling
    this.setupVisualViewport();
  }

  private setupVisualViewport() {
    if (typeof window === 'undefined' || !window.visualViewport || !this.repositionInputs()) {
      return;
    }

    const onVisualViewportChange = () => {
      if (!this.drawerRef()?.nativeElement) return;

      const focusedElement = document.activeElement as HTMLElement;
      if (this.isInput(focusedElement) || this.keyboardIsOpen()) {
        this.handleInputFocus();
      }
    };

    window.visualViewport.addEventListener('resize', onVisualViewportChange);
    this.destroy$.subscribe(() => {
      window.visualViewport?.removeEventListener('resize', onVisualViewportChange);
    });
  }

  private handleInputFocus() {
    const visualViewportHeight = window.visualViewport?.height || 0;
    const totalHeight = window.innerHeight;
    const diffFromInitial = totalHeight - visualViewportHeight;
    const drawerHeight = this.drawerRef()?.nativeElement.getBoundingClientRect().height ?? 0;
    const isTallEnough = drawerHeight > totalHeight * 0.8;

    if (!this.initialDrawerHeight()) {
      this.initialDrawerHeight.set(drawerHeight);
    }

    if (Math.abs(this.previousDiffFromInitial() - diffFromInitial) > 60) {
      this.keyboardIsOpen.set(!this.keyboardIsOpen());
    }

    this.previousDiffFromInitial.set(diffFromInitial);
    this.updateDrawerHeight(drawerHeight, visualViewportHeight, isTallEnough);
  }

  private updateDrawerHeight(drawerHeight: number, visualViewportHeight: number, isTallEnough: boolean) {
    if (drawerHeight > visualViewportHeight || this.keyboardIsOpen()) {
      const offsetFromTop = this.drawerRef()?.nativeElement.getBoundingClientRect().top;
      let newHeight = drawerHeight;
      if (drawerHeight > visualViewportHeight) {
        newHeight = visualViewportHeight - (isTallEnough ? offsetFromTop ?? 0 : 0);
      }

      this.drawerHeight.set(`${Math.max(newHeight, visualViewportHeight - (offsetFromTop ?? 0))}px`);
    } else {
      this.drawerHeight.set(`${this.initialDrawerHeight()}px`);
    }
  }

  private isInput(element: Element | null): boolean {
    if (!element) return false;
    return (
      (element instanceof HTMLInputElement && !this.nonTextInputTypes.has(element.type)) ||
      element instanceof HTMLTextAreaElement ||
      (element instanceof HTMLElement && element.isContentEditable)
    );
  }

  private readonly nonTextInputTypes = new Set([
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

  ngAfterViewInit() {
    if (this.drawerRef()?.nativeElement) {
      this.drawerService.setDrawerRef(this.drawerRef()?.nativeElement || null);
    }
    if (this.direction()) {
      this.drawerService.snapPointsService.setDirection(this.direction());
    }
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.drawerService.setDrawerRef(null);
  }

  onPress(event: PointerEvent) {
    this.drawerService.onPress(event);
  }

  onDrag(event: PointerEvent) {
    this.drawerService.onDrag(event);
  }

  onRelease(event: PointerEvent) {
    this.drawerService.onRelease(event);
  }
} 