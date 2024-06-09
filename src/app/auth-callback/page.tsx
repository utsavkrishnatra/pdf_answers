"use client"

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { trpc } from '../_trpc/client';
import { Loader2 } from 'lucide-react';

const Page = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const origin = searchParams.get('origin');
  console.log('Origin:', origin);
  
  // const { data, error, isLoading } = trpc.authCallback.useQuery();
  
  const { data, error, isLoading } = trpc.authCallback.useQuery(undefined, {
    retry: true, // Enable retry
    retryDelay: 500 // Set retry delay to 500 milliseconds
  });
  useEffect(() => {
    if (data) {
      const { success } = data;
      console.log('Success:', success);
      if (success) {
        // user is synced to db
        console.log('Redirecting to:', origin ? `/${origin}` : '/dashboard');
        router.push(origin ? `/${origin}` : '/dashboard');
      }
    }
  }, [data, origin, router]);

  useEffect(() => {
    if (error) {
      console.error('Error:', error);
      if (error.data?.code === 'UNAUTHORIZED') {
        router.push('/sign-in');
      }
    }
  }, [error, router]);

  console.log('Data:', data);
  console.log('Error:', error);
  console.log('Is Loading:', isLoading);
  
  // Check if origin is null or undefined
  if (origin === null) {
    return <div>Origin is null. Please try again later.</div>;
  }

  if (isLoading) {
    return (
      <div className='w-full mt-24 flex justify-center'>
        <div className='flex flex-col items-center gap-2'>
          <Loader2 className='h-8 w-8 animate-spin text-zinc-800' />
          <h3 className='font-semibold text-xl'>
            Setting up your account...
          </h3>
          <p>You will be redirected automatically.</p>
        </div>
      </div>
    );
  }

  // Handle error case
  return (
    <div>Error occurred. Please try again later.</div>
  );
}

export default Page;



