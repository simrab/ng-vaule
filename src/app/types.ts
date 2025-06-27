export const DrawerDirection = {
  BOTTOM: 'bottom',
  RIGHT: 'right',
} as const;
export type DrawerDirectionType = (typeof DrawerDirection)[keyof typeof DrawerDirection];
export interface SnapPoint {
  fraction: number;
  height: number;
}

export type AnyFunction = (...args: any) => any;
