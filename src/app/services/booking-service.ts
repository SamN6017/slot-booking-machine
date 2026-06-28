import { inject, Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { AuthService } from './auth-service';
import { environment } from '../../environments/environment';

export interface Machine { id: number; name: string; status: string; }
export interface Booking {
  id: number; // Made concrete for track tracking routines
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

  /**
   * Expects exactly 2 arguments to perfectly match your dashboard template signature
   */
  async createBooking(machineId: number, startTime: Date): Promise<void> {
    const userId = this.authService.currentUserId();
    const userEmail = this.authService.currentUser()?.email;

    if (!userId || !userEmail) {
      throw new Error('Authentication required. Please log in.');
    }

    const endTime = new Date(startTime.getTime() + 30 * 60 * 1000);

    // --- Business Validation Guard Boundaries ---
    const dayOfWeek = startTime.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      throw new Error('Invalid Reservation: Weekdays only (Mon-Fri).');
    }

    const startHour = startTime.getHours();
    const endHour = endTime.getHours();
    const endMinutes = endTime.getMinutes();
    if (startHour < 8 || (endHour > 20 || (endHour === 20 && endMinutes > 0))) {
      throw new Error('Invalid Reservation: Must fall between 8:00 AM - 8:00 PM.');
    }

    const startMinutes = startTime.getMinutes();
    if (startMinutes !== 0 && startMinutes !== 30) {
      throw new Error('Invalid Reservation: Slots must start on the hour or half-hour.');
    }

    const isoStart = startTime.toISOString();
    const isoEnd = endTime.toISOString();

    const holdsOverlap = this.currentWeekBookings().some(booking => {
      return (
        booking.machine_id === machineId &&
        isoStart < booking.end_time &&
        isoEnd > booking.start_time
      );
    });

    if (holdsOverlap) throw new Error('Slot conflict: Already reserved.');

    // Push data directly to your 5-column table structure
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
    await this.loadWeeklyBookings();
  }

  /**
   * RESTORES THE MISSING ACTION: Drops rows via incoming target row Primary Keys
   */
  async cancelBooking(bookingId: number): Promise<void> {
    const { error } = await this.supabase
      .from('bookings')
      .delete()
      .eq('id', bookingId);

    if (error) {
      throw new Error(`Failed to delete booking: ${error.message}`);
    }

    // Refresh memory streams automatically to free up the grid slot
    await this.loadWeeklyBookings();
  }
}