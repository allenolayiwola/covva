import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { contentMaxWidth, gridColumns, isWide, hasRail, type Fold } from './index';

export function useLayout() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const availableWidth = Math.max(0, width - insets.left - insets.right);
  // No posture API is installed. Never infer a hinge from dimensions.
  const fold: Fold | null = null;
  return { width, height, insets, availableWidth, isWide: isWide(width),
    hasRail: hasRail(width), contentMaxWidth: contentMaxWidth(),
    columns: gridColumns(availableWidth - 48), fold, creaseGap: 0 };
}
