export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

export type AuthState = {
  user: SessionUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
};

export type LoginRequest = {
  email: string;
  password: string;
};

export type RegisterRequest = {
  email: string;
  password: string;
  name: string;
};

export type AuthResponse = {
  user: SessionUser;
};

export type AuthError = {
  error: string;
};
