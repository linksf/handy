import {render,screen,waitFor} from '@testing-library/react';
import {describe,test,expect,vi} from 'vitest';
vi.mock('../firebase',()=>({functions:{}}));
vi.mock('firebase/functions',()=>({httpsCallable:()=>async()=>({data:{start:'2026-10-12',end:'2026-10-19',collectedCents:10000,expenseCents:1000,leadFeesCents:2000,convertedFeesCents:1000,unconvertedFeesCents:1000,netCents:7000,outstandingCents:5000,undatedPaymentsCents:2500,undatedExpensesCents:0,undatedLeadFeesCents:1000,pendingLeadFeesCents:0,observedLeadFeesCents:0,unknownLeadFeeCount:1}})}));
import FinancialReports from './FinancialReports';
describe('cash reports',()=>{test('shows collected cash, net cash and incomplete historical data',async()=>{render(<FinancialReports/>);await waitFor(()=>expect(screen.getByText('$70.00')).toBeInTheDocument());expect(screen.getByText(/Undated historical payments: \$25.00/)).toBeInTheDocument();expect(screen.getByText(/Leads without a known fee amount: 1/)).toBeInTheDocument();expect(screen.getByText('Week (Monday–Sunday)')).toBeInTheDocument();});});
