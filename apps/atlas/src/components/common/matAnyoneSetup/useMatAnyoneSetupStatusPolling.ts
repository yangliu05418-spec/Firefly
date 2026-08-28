import { useEffect, type RefObject } from 'react';
import { getMatAnyoneService } from '../../../services/matanyone/MatAnyoneService';
import { ensureKeyframes } from './styles';

export function useMatAnyoneSetupStatusPolling(
  setupLog: string[],
  logEndRef: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    ensureKeyframes();
  }, []);

  useEffect(() => {
    getMatAnyoneService().checkStatus();
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logEndRef, setupLog]);
}
