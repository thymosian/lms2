import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import BillingPage from '@/components/billing/BillingPage';

export const metadata = {
  title: 'Billing & Subscription | Theraptly',
  description: 'Manage your subscription plan, billing history, and payment methods.',
};

export default async function BillingPageRoute() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  // Server-side admin gate and fetch org staff count in a single query
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      role: true,
      organizationId: true,
      organization: {
        select: { staffCount: true },
      },
    },
  });

  if (!user || user.role !== 'admin') {
    redirect('/dashboard');
  }

  return <BillingPage staffCount={user.organization?.staffCount ?? null} />;
}
