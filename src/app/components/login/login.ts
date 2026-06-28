import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth-service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html'
})
export class Login {
  private authService = inject(AuthService);
  private router = inject(Router);

  // Template state signals
  email = signal('');
  password = signal('');
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);
  isLoading = signal(false);
  isSignUpMode = signal(false); // Toggles between Login and Register views

  /**
   * Toggles the UI state between sign-in and registration modes
   */
  toggleMode(): void {
    this.isSignUpMode.update(mode => !mode);
    this.clearMessages();
  }

  /**
   * Main form submission coordinator
   */
  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    this.clearMessages();
    this.isLoading.set(true);

    try {
      if (this.isSignUpMode()) {
        await this.authService.signUp(this.email(), this.password());
        this.successMessage.set('Registration successful! Please check your email to confirm your account.');
        // Reset form input values
        this.email.set('');
        this.password.set('');
      } else {
        await this.authService.signIn(this.email(), this.password());
        this.router.navigate(['/dashboard']);
      }
    } catch (err: any) {
      this.errorMessage.set(err.message || 'An unexpected authentication error occurred.');
    } finally {
      this.isLoading.set(false);
    }
  }

  private clearMessages(): void {
    this.errorMessage.set(null);
    this.successMessage.set(null);
  }
}