import { useState } from 'react';
import { z } from 'zod';
import { supabase } from '../src/lib/supabase';
import { ActionButton, Button, Card, Copy, Field, Notice, Screen } from '../src/components/ui';

type Mode = 'sign-in' | 'sign-up' | 'phone';
export default function SignIn() {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [sentPhone, setSentPhone] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  async function submit() {
    setNotice(null);
    if (mode === 'phone') {
      if (sentPhone) {
        if (!/^\d{6}$/.test(token.trim())) throw new Error('Enter the six-digit code.');
        const { error } = await supabase.auth.verifyOtp({ phone: sentPhone, token: token.trim(), type: 'sms' });
        if (error) throw error;
      } else {
        const number = phone.trim();
        if (!/^\+[1-9]\d{8,14}$/.test(number)) throw new Error('Include your country code, for example +233.');
        const { error } = await supabase.auth.signInWithOtp({ phone: number });
        if (error) throw error;
        setSentPhone(number); setNotice('Enter the code sent to your phone.');
      }
      return;
    }
    const address = email.trim();
    if (!z.email().safeParse(address).success) throw new Error('Enter a valid email address.');
    if (!password || (mode === 'sign-up' && password.length < 8)) throw new Error('Enter your password (at least eight characters for a new account).');
    if (mode === 'sign-up') {
      if (!name.trim()) throw new Error('Enter your full name.');
      if (phone.trim() && !/^\+[1-9]\d{8,14}$/.test(phone.trim())) throw new Error('Include the country code for your phone number.');
      const { data, error } = await supabase.auth.signUp({ email: address, password, options: { data: { full_name: name.trim(), phone: phone.trim() || null, account_type: 'individual' } } });
      if (error) throw error;
      if (!data.session) setNotice('Check your email to confirm your account, then return here to sign in.');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: address, password });
      if (error) throw error;
    }
  }
  function change(next: Mode) { setMode(next); setNotice(null); setPassword(''); setSentPhone(null); setToken(''); }
  return <Screen title={mode === 'sign-up' ? 'Create Your Account' : 'Welcome To Covva'}>
    <Copy>Keep your cover journey in one place.</Copy>
    <Card>
      {mode === 'sign-up' && <Field label="Full Name" value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" />}
      {mode !== 'phone' && <><Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" /><Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'} /></>}
      {mode !== 'sign-in' && <Field label={mode === 'sign-up' ? 'Phone (Optional)' : 'Phone'} value={phone} onChangeText={setPhone} editable={!sentPhone} keyboardType="phone-pad" autoComplete="tel" placeholder="+233…" />}
      {sentPhone && <Field label="Verification Code" value={token} onChangeText={setToken} keyboardType="number-pad" autoComplete="sms-otp" maxLength={6} />}
      <ActionButton key={`${mode}-${sentPhone}`} title={mode === 'phone' ? (sentPhone ? 'Verify Code' : 'Send Code') : mode === 'sign-up' ? 'Create Account' : 'Sign In'} action={submit} />
      <Notice message={notice} />
      {sentPhone && <Button title="Use Another Number" secondary onPress={() => { setSentPhone(null); setToken(''); setNotice(null); }} />}
    </Card>
    <Button title={mode === 'phone' ? 'Use Email Instead' : 'Use Phone Instead'} secondary onPress={() => change(mode === 'phone' ? 'sign-in' : 'phone')} />
    <Button title={mode === 'sign-up' ? 'Already Have An Account? Sign In' : 'Create An Account'} secondary onPress={() => change(mode === 'sign-up' ? 'sign-in' : 'sign-up')} />
  </Screen>;
}
