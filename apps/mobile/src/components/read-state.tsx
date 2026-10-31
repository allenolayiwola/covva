import { ActivityIndicator } from 'react-native';
import { colors } from '@im/tokens';
import { Button, Notice } from './ui';

export function ReadState({ loading, error, retry, label }: { loading: boolean; error?: string; retry: () => void; label: string }) {
  if (loading) return <ActivityIndicator accessibilityLabel={label} color={colors.brand} />;
  if (error) return <><Notice message={error} /><Button title="Try Again" onPress={retry} secondary /></>;
  return null;
}
