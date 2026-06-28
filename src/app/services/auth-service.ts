import { Injectable, signal, computed } from '@angular/core';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private supabase: SupabaseClient;

  // 1. Core reactive state container using Angular 21 Signals
  private userSignal = signal<User | null>(null);

  // 2. Public read-only Signals for components to consume cleanly
  public currentUser = computed(() => this.userSignal());
  public isAuthenticated = computed(() => this.userSignal() !== null);
  public currentUserId = computed(() => this.userSignal()?.id);

  constructor() {
    // Initialize the direct Supabase engine client
    this.supabase = createClient(
      environment.supabaseUrl, 
      environment.supabaseKey
    );

    // 3. Sync initial storage session state instantly on application boot
    this.initializeSession();

    // 4. Register a live listener to handle cross-tab events, token renewals, or logouts
    this.supabase.auth.onAuthStateChange((event, session) => {
      this.userSignal.set(session?.user ?? null);
    });
  }

  /**
   * Retrieves current session securely from browser local storage
   */
  private async initializeSession(): Promise<void> {
    const { data: { session }, error } = await this.supabase.auth.getSession();
    if (!error && session) {
      this.userSignal.set(session.user);
    }
  }

  /**
   * Signs up a new team member with their email and a unique password
   */
  async signUp(email: string, password: string): Promise<void> {
    const { error } = await this.supabase.auth.signUp({
      email,
      password
    });

    if (error) {
      throw new Error(`Registration failed: ${error.message}`);
    }
  }

  /**
   * Authenticates an existing team user
   */
  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  /**
   * Terminates the user session and cleans local storage tokens
   */
  async signOut(): Promise<void> {
    const { error } = await this.supabase.auth.signOut();
    
    if (error) {
      throw new Error(`Sign out failed: ${error.message}`);
    }
    
    // Explicitly wipe the signal state
    this.userSignal.set(null);
  }
}