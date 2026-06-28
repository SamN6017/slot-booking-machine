import { inject, Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AuthService } from './auth-service';
import { environment } from '../../environments/environment';

export interface Machine {
  id: number;
  name: string;
  status: string;
}

export interface Booking {
  id: number;
  machine_id: number;
  user_id: string;
  user_email: string;
  start_time: string; // UTC ISO String representation
  end_time: string;   // UTC ISO String representation
}

@Injectable({ providedIn: 'root' })
export class BookingService {
  private authService = inject(AuthService);
  private supabase: SupabaseClient = createClient(environment.supabaseUrl, environment.supabaseKey);

  // Core reactive application state via Signals
  public machines = signal<Machine[]>([]);
  public currentWeekBookings = signal<Booking[]>([]);

  constructor() {
    // Initialize the real-time synchronization socket on service instantiation
    this.setupRealtimeListener();
  }

  /**
   * Subscribes to real-time events via WebSockets from Supabase.
   * Seamlessly applies remote changes to the signal array in real time.
   */
  private setupRealtimeListener(): void {
    this.supabase
      .channel('public:bookings')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookings' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newBooking = payload.new as Booking;
            // Atomic state appendment across all concurrent open client views
            this.currentWeekBookings.update(current => {
              // Deduplicate checking to prevent matching internal insert state bounces
              if (current.some(b => b.id === newBooking.id)) return current;
              return [...current, newBooking];
            });
          }
          else if (payload.eventType === 'DELETE') {
            const oldBooking = payload.old as Partial<Booking>;
            // Instantly remove slot from local matrix ledger
            this.currentWeekBookings.update(current =>
              current.filter(b => b.id !== oldBooking.id)
            );
          }
        }
      )
      .subscribe();
  }

  /**
   * Loads all available target machines
   */
  async loadMachines(): Promise<void> {
    const { data, error } = await this.supabase
      .from('machines')
      .select('*')
      .eq('status', 'AVAILABLE');

    if (error) throw error;
    this.machines.set(data || []);
  }

  /**
   * Performed on initialization to populate the grid baseline
   */
  async loadWeeklyBookings(): Promise<void> {
    const { data, error } = await this.supabase
      .from('bookings')
      .select('id, machine_id, user_id, user_email, start_time, end_time');

    if (error) throw error;
    this.currentWeekBookings.set(data || []);
  }

  /**
   * Core validation processor and transaction pipeline for slots
   */
  async createBooking(machineId: number, startTime: Date): Promise<void> {
    const userId = this.authService.currentUserId();
    const userEmail = this.authService.currentUser()?.email;

    if (!userId || !userEmail) {
      throw new Error('Authentication required: Access session context missing.');
    }

    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);

    // --- RULE 1: Weekday Filter Verification (Mon = 1, ..., Fri = 5) ---
    const dayOfWeek = startTime.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      throw new Error('Operation Blocked: Machines can only be allocated on weekdays.');
    }

    // --- RULE 2: Shift Boundaries Check (8:00 AM - 8:00 PM) ---
    const startHour = startTime.getHours();
    const endHour = endTime.getHours();
    const endMinutes = endTime.getMinutes();
    if (startHour < 8 || (endHour > 20 || (endHour === 20 && endMinutes > 0))) {
      throw new Error('Operation Blocked: Slots must fall within building hours (8:00 AM - 8:00 PM).');
    }

    // --- RULE 3: Strict 30-Minute Interval Alignment Verification ---
    const startMinutes = startTime.getMinutes();
    if (startMinutes !== 0 && startMinutes !== 30) {
      throw new Error('Operation Blocked: Slots must explicitly map to a 30-minute block boundary.');
    }

    const isoStart = startTime.toISOString();
    const isoEnd = endTime.toISOString();

    // --- RULE 4: Local Cache Race Condition Pre-Check Validation ---
    const holdsOverlap = this.currentWeekBookings().some(booking => {
      return (
        booking.machine_id === machineId &&
        isoStart < booking.end_time &&
        isoEnd > booking.start_time
      );
    });

    if (holdsOverlap) {
      throw new Error('Concurrency Conflict: This slot was captured by another teammate a brief moment ago.');
    }

    // Write verified ledger metrics straight to database row
    const { error } = await this.supabase
      .from('bookings')
      .insert([{
        machine_id: machineId,
        user_id: userId,
        user_email: userEmail,
        start_time: isoStart,
        end_time: isoEnd
      }]);

    if (error) throw new Error(`Database Write Error: ${error.message}`);
    // Note: We don't manually fetch data here since the websocket handles tracking natively
  }

  /**
   * Removes reservation mapping securely by target ID parameters
   */
  async cancelBooking(bookingId: number): Promise<void> {
    const { error } = await this.supabase
      .from('bookings')
      .delete()
      .eq('id', bookingId);

    if (error) {
      throw new Error(`Database Termination Error: ${error.message}`);
    }
  }
}