import { parseRoleToken, roleToken, type ColorRole } from '../../domain/colors';
import { mapSvgPaint } from './svgDocument';

const BACKGROUND_ROLES: Readonly<Record<ColorRole, ColorRole>> = {
  bg1: 'bg1',
  // TODO: Правило для bg2 не подтверждено на объекте vase.
  bg2: 'bg2',
  bg3: 'bg3',
  black: 'bg3',
  obj1: 'bg1',
  obj2: 'bg1',
  obj3: 'bg1',
  white: 'bg1',
};

export function toBackgroundVariant(svg: string): string {
  return mapSvgPaint(svg, (value) => {
    const role = parseRoleToken(value);
    return role === undefined ? value : roleToken(BACKGROUND_ROLES[role]);
  });
}
