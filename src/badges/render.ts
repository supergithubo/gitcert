/**
 * Badge template dispatcher (M2 spec §Interface Contract): routes props to
 * the flat or pill template. Pure — identical props yield identical bytes.
 */

import { flatBadge } from './flat';
import { pillBadge } from './pill';
import type { BadgeProps } from './types';

export function renderBadge(props: BadgeProps): string {
  return props.style === 'pill' ? pillBadge(props) : flatBadge(props);
}
