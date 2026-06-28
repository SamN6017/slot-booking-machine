import { inject, Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AuthService } from './auth-service';
import { environment } from '../../environments/environment';

export interface Machine { id: number; name: string; status: string; }
export interface Booking {
  id: number;
  machine_id: number;
  user_id: string;
  user_email: string;
  start_time: string;
  end_time: string;
}

@Injectable({ providedIn: 'root' })
export class BookingService {
  private authService = inject(AuthService);
  private supabase: SupabaseClient = createClient(environment.supabaseUrl, environment.supabaseKey);

  public machines = signal<Machine[]>([]);
  public currentWeekBookings = signal<Booking[]>([]);

  constructor() {
    // START LISTENING TO REALTIME CHANGES INSTANTLY ON APP BOOT
    this.setupRealtimeListener();
  }

  /**
   * Connects a permanent WebSocket stream to Supabase.
   * Instantly handles external inserts and deletes without pulling data manually.
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
            // Append the new booking to our reactive signal stream
            this.currentWeekBookings.update(current => [...current, newBooking]);
          }
          else if (payload.eventType === 'DELETE') {
            const oldBooking = payload.old as Partial<Booking>;
            // Remove the deleted booking row from our signal array instantly
            this.currentWeekBookings.update(current =>
              current.filter(b => b.id !== oldBooking.id)
            );
          }
        }
      )
      .subscribe();
  }

  async loadMachines(): Promise<void> {
    const { data, error } = await this.supabase
      .from('machines')
      .select('*')
      .eq('status', 'AVAILABLE');

    if (error) throw error;
    this.machines.set(data || []);
  }

  async loadWeeklyBookings(): Promise<void> {
    const { data, error } = await this.supabase
      .from('bookings')
      .select('id, machine_id, user_id, user_email, start_time, end_time');

    if (error) throw error;
    this.currentWeekBookings.set(data || []);
  }

  async createBooking(machineId: number, startTime: Date): Promise<void> {
    const userId = this.authService.currentUserId();
    const userEmail = this.authService.currentUser()?.email;

    if (!userId || !userEmail) {
      throw new Error('Authentication required. Please log in.');
    }

    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);
    const isoStart = startTime.toISOString();
    const isoEnd = endTime.toISOString();

    // --- Strict Local Overlap Validation Pre-Check ---
    const holdsOverlap = this.currentWeekBookings().some(booking => {
      return (
        booking.machine_id === machineId &&
        isoStart < booking.end_time &&
        isoEnd > booking.start_time
      );
    });

    if (holdsOverlap) throw new Error('Slot conflict: This window was just taken by another teammate!');

    const { error } = await this.supabase
      .from('bookings')
      .insert([{
        machine_id: machineId,
        user_id: userId,
        user_email: userEmail,
        start_time: isoStart,
        end_time: isoEnd
      }]);

    if (error) throw new Error(`Database error: ${error.message}`);
    // Note: We don't need to manually call loadWeeklyBookings() here anymore 
    // because our Realtime listener picks up our own inserts too!
  }

  async cancelBooking(bookingId: number): Promise<void> {
    const { error } = await this.supabase
      .from('bookings')
      .delete()
      .eq('id', bookingId);

    if (error) {
      throw new Error(`Failed to delete booking: ${error.message}`);
    }
    // Realtime listener handles removing it locally automatically
  }
}