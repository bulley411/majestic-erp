import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getBudgetSummary, getMonthlyAnalysis, getVarianceReport } from '../../lib/api';

const naira = (v: string) =>
  '₦' + Number(v).