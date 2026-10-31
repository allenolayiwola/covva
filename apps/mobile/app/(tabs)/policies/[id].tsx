import { useLocalSearchParams } from 'expo-router';
import { PolicyWallet } from '../../../src/components/policy-wallet';
export default function PolicyRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PolicyWallet selectedId={id} />;
}
