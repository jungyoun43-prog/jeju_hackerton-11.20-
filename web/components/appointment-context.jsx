'use client';
import { createContext, useContext } from 'react';
import { Button } from './ui/button';
export const AppointmentContext=createContext(null);
export const useAppointment=()=>useContext(AppointmentContext);
export function Action({action,value='',children,primary=false,selected,variant='outline',...props}) {
  const {onAction}=useAppointment();
  return <Button type="button" variant={primary?'default':variant} data-book-action={action} data-book-value={value} aria-pressed={selected} {...props} className={`${primary?'appointment-primary ':''}${props.className || ''}`} onClick={event=>onAction(action,value,event.currentTarget)}>{children}</Button>;
}
export function Note({children}) {return <p className="appointment-note">{children}</p>;}
