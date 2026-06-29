import { Component, OnInit, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BookingService, Booking } from '../../services/booking-service';
import { AuthService } from '../../services/auth-service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.html'
})
export class Dashboard implements OnInit {
  public bookingService = inject(BookingService);
  public authService = inject(AuthService);

  // Link template arrays to our service Signals
  machines = this.bookingService.machines;
  bookings = this.bookingService.currentWeekBookings;

  // Trackers for calendar layout matrix setup
  activeDays = signal<Date[]>([]);
  timeSlots = signal<string[]>([]);
  expandedDayTime = signal<number | null>(null);

  public dashboardComponentDateParser(timeStr: string, baseDate: Date): Date {
    return this.parseTimeToDate(timeStr, baseDate);
  }

 
  public isSlotInPast(slotDate: Date): boolean {
    const now = new Date();
    return slotDate.getTime() < now.getTime();
  }

  bookingLookup = computed(() => {
    const map = new Map<string, Booking>();
    for (const b of this.bookings()) {
      // b.start_time is already a string format like: "2026-06-29 09:00:00"
      const key = `${b.machine_id}_${b.start_time}`;
      map.set(key, b);
    }
    return map;
  });

  async ngOnInit() {
    await Promise.all([
      this.bookingService.loadMachines(),
      this.bookingService.loadWeeklyBookings()
    ]);

    this.generateActiveDaysWindow();
    this.timeSlots.set(this.generateTimeSlots());
  }

  /**
   * Computes layout array containing days from Today until next Friday evening
   */
  private generateActiveDaysWindow(): void {
    const days: Date[] = [];
    const current = new Date();

    for (let i = 0; i < 14; i++) {
      const candidateDate = new Date(current.getTime() + i * 24 * 60 * 60 * 1000);
      const dayOfWeek = candidateDate.getDay();

      if (dayOfWeek === 5 && days.length > 0) {
        days.push(candidateDate);
        break;
      }

      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        days.push(candidateDate);
      }
    }
    this.activeDays.set(days);
  }

  generateTimeSlots(): string[] {
    const slots: string[] = [];
    for (let hour = 8; hour < 20; hour += 0.5) {
      const h = Math.floor(hour);
      const m = hour % 1 === 0 ? '00' : '30';
      const period = h >= 12 ? 'PM' : 'AM';
      const displayHour = h > 12 ? h - 12 : h === 0 ? 12 : h;
      slots.push(`${displayHour}:${m} ${period}`);
    }
    return slots;
  }

  getBookingAt(machineId: number, targetDate: Date, slotTimeString: string): Booking | null {
    const parsedDate = this.parseTimeToDate(slotTimeString, targetDate);

    const pad = (num: number) => String(num).padStart(2, '0');
    const yyyy = parsedDate.getFullYear();
    const mm = pad(parsedDate.getMonth() + 1);
    const dd = pad(parsedDate.getDate());
    const hh = pad(parsedDate.getHours());
    const min = pad(parsedDate.getMinutes());

    // Matches 'YYYY-MM-DDTHH:mm:ss+00:00' exactly as it appears in your console log
    const estLiteralStr = `${yyyy}-${mm}-${dd}T${hh}:${min}:00+00:00`;
    const key = `${machineId}_${estLiteralStr}`;

    return this.bookingLookup().get(key) || null;
  }

  /**
   * Direct click handler for inline booking/release operations
   */
  async handleSlotInteraction(machineId: number, slotTimeString: string, targetDate: Date) {
    const existingBooking = this.getBookingAt(machineId, targetDate, slotTimeString);

    if (existingBooking) {
      if (existingBooking.user_id === this.authService.currentUserId()) {
        if (confirm('Do you want to release your time slot reservation?')) {
          try {
            await this.bookingService.cancelBooking(existingBooking.id);
          } catch (err: unknown) {
            // FIX: Explicitly typecast to safely extract message string
            const message = err instanceof Error ? err.message : 'An unknown database termination error occurred.';
            alert(message);
          }
        }
      }
    } else {
      try {
        const parsedDate = this.parseTimeToDate(slotTimeString, targetDate);
        await this.bookingService.createBooking(machineId, parsedDate);
      } catch (err: unknown) {
        // FIX: Explicitly typecast to safely extract message string
        const message = err instanceof Error ? err.message : 'An unknown scheduling block validation error occurred.';
        alert(message);
      }
    }
  }

  toggleDayAccordion(dayTime: number): void {
    this.expandedDayTime.update(current => current === dayTime ? null : dayTime);
  }

  private parseTimeToDate(timeStr: string, baseDate: Date): Date {
    const [time, period] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    const finalDate = new Date(baseDate);
    finalDate.setHours(hours, minutes, 0, 0);
    return finalDate;
  }
}