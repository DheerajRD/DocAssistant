import Workspace from '@/components/Workspace';
import { productName } from '@/lib/config';
export const dynamic = 'force-dynamic';
export default function Page() {
  const ready = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.APP_URL
  );
  return <Workspace name={productName} configured={ready} />;
}
