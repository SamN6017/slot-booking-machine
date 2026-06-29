import { inject, Injectable, signal, NgZone } from '@angular/core';
import { AuthService } from './auth-service';

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
  start_time: string; // "YYYY-MM-DD HH:mm:ss" matching EST
  end_time: string;   // "YYYY-MM-DD HH:mm:ss" matching EST
}

@Injectable({ providedIn: 'root' })
export class BookingService {
  private authService = inject(AuthService);
  private zone = inject(NgZone);

  // FIX: Reuses the existing client instance from AuthService to prevent undefined session behavior
  private supabase = this.authService.supabase;

  // Core application state
  public machines = signal<Machine[]>([]);
  public currentWeekBookings = signal<Booking[]>([]);

  private formatToEstString(date: Date): string {
    const pad = (num: number) => String(num).padStart(2, '0');
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:00`;
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
   * Fetches the baseline bookings list in literal EST strings
   */
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

    // Capture explicit, literal time strings ignoring standard browser UTC manipulation offsets
    const estStartStr = this.formatToEstString(startTime);
    const estEndStr = this.formatToEstString(endTime);

    const holdsOverlap = this.currentWeekBookings().some(booking => {
      return (
        booking.machine_id === machineId &&
        estStartStr < booking.end_time &&
        estEndStr > booking.start_time
      );
    });

    if (holdsOverlap) throw new Error('Slot conflict: Already reserved.');

    // Write straight to your table structure
    const { error } = await this.supabase
      .from('bookings')
      .insert([{
        machine_id: machineId,
        user_id: userId,
        user_email: userEmail,
        start_time: estStartStr,
        end_time: estEndStr
      }]);

    if (error) throw new Error(`Database error: ${error.message}`);

    // Instantly sync layout locally following successful write transaction confirmations
    await this.loadWeeklyBookings();
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

    // Instantly sync layout locally following successful delete transaction confirmations
    await this.loadWeeklyBookings();
  }
}