// CheckoutForm.tsx - Payment form components.
import React, { useState } from 'react';
import type { PaymentIntent } from '@stripe/stripe-js';
import { useStripe, useElements, CardElement } from '@stripe/react-stripe-js';
import { supabase } from '@/integrations/supabase/client';

// ==================== Payment Form Component Section ====================

// ✅ Type-safe interface definitions
interface PaymentData {
  amount: number;
  currency: string;
  productIds: string[];
  customerInfo: {
    name: string;
    email: string;
    phone?: string;
  };
}

interface CheckoutFormProps {
  paymentData: PaymentData;
  onSuccess?: (paymentIntent: PaymentIntent) => void;
  onError?: (error: string) => void;
}

// ✅ Improved payment form component
export const CheckoutForm: React.FC<CheckoutFormProps> = ({
  paymentData,
  onSuccess,
  onError
}) => {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ✅ Complete payment processing flow
  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    
    // Validate required conditions
    if (!stripe || !elements) {
      setErrorMessage('Payment system is initializing, please try again later');
      return;
    }

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      setErrorMessage('Payment form did not load correctly');
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      // ✅ Step 1: Create payment intent
      console.log('🔄 Creating payment intent...');
      const { data, error } = await supabase.functions.invoke<{ client_secret: string }>('create-payment-intent', {
        body: {
          amount: paymentData.amount,
          currency: paymentData.currency,
          product_ids: paymentData.productIds,
          customer_info: paymentData.customerInfo
        }
      });

      if (error) {
        throw new Error(`Failed to create payment intent: ${error.message}`);
      }

      if (!data?.client_secret) {
        throw new Error('Server returned invalid payment configuration');
      }

      console.log('✅ Payment intent created successfully');

      // ✅ Step 2: Confirm payment
      console.log('🔄 Processing payment...');
      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(
        data.client_secret,
        {
          payment_method: {
            card: cardElement,
            billing_details: {
              name: paymentData.customerInfo.name,
              email: paymentData.customerInfo.email,
              phone: paymentData.customerInfo.phone
            }
          }
        }
      );

      if (stripeError) {
        throw new Error(stripeError.message || 'Payment processing failed');
      }

      if (paymentIntent?.status === 'succeeded') {
        console.log('✅ Payment successful');

        // ✅ Step 3: Confirm order (optional)
        try {
          await supabase.functions.invoke('confirm-payment', {
            body: {
              payment_intent_id: paymentIntent.id,
              order_data: {
                amount: paymentData.amount,
                currency: paymentData.currency,
                products: paymentData.productIds,
                customer: paymentData.customerInfo
              }
            }
          });
          console.log('✅ Order confirmation successful');
        } catch (confirmError) {
          console.warn('⚠️ Order confirmation failed, but payment completed:', confirmError);
        }

        // Call success callback
        onSuccess?.(paymentIntent);
      } else {
        throw new Error(`Payment status abnormal: ${paymentIntent?.status}`);
      }

    } catch (error: unknown) {
      console.error('❌ Payment failed:', error);
      const errorMsg = error instanceof Error && error.message
        ? error.message
        : 'Unknown error occurred during payment process';
      setErrorMessage(errorMsg);
      onError?.(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* ✅ Error message */}
      {errorMessage && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-700 text-sm">{errorMessage}</p>
        </div>
      )}

      {/* ✅ Credit card input */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          Credit Card Information
        </label>
        <div className="border rounded-md p-3 bg-white">
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: '16px',
                  color: '#424770',
                  '::placeholder': {
                    color: '#aab7c4',
                  },
                },
                invalid: {
                  color: '#9e2146',
                },
              },
            }}
          />
        </div>
        <p className="text-xs text-gray-500">
          Test card: 4242 4242 4242 4242 | Expiry: Any future date | CVC: Any 3 digits
        </p>
      </div>

      {/* ✅ Submit button */}
      <button
        type="submit"
        disabled={!stripe || loading}
        className={`w-full py-2 px-4 rounded-md font-medium ${
          loading
            ? 'bg-gray-400 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700 text-white'
        }`}
      >
        {loading ? (
          <span className="flex items-center justify-center">
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Processing payment...
          </span>
        ) : (
          `Pay Now $${(paymentData.amount / 100).toFixed(2)}`
        )}
      </button>
    </form>
  );
};

// ✅ Export default usage example
export const ExampleUsage = () => {
  const handlePaymentSuccess = (paymentIntent: PaymentIntent) => {
    console.log('Payment successful!', paymentIntent);
    // Redirect to success page or show success message
  };

  const handlePaymentError = (error: string) => {
    console.error('Payment failed:', error);
    // Show error message to user
  };

  const examplePaymentData: PaymentData = {
    amount: 2000, // $20.00 USD (in cents)
    currency: 'usd',
    productIds: ['prod_1', 'prod_2'],
    customerInfo: {
      name: 'John Doe',
      email: 'john@example.com',
      phone: '+1234567890'
    }
  };

  return (
    <CheckoutForm
      paymentData={examplePaymentData}
      onSuccess={handlePaymentSuccess}
      onError={handlePaymentError}
    />
  );
};
