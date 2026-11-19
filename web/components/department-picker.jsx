'use client';
import { SearchPicker } from './search-picker';
import { APPOINTMENT_DEPARTMENTS } from '../../app/appointment-departments.js';
import { useAppointment } from './appointment-context';

export function DepartmentPicker() {
  const {state,onAction}=useAppointment();
  return <SearchPicker id="appointment-department" label="진료과" value={state.department} options={APPOINTMENT_DEPARTMENTS.map(d=>({value:d.name,label:d.name}))} onChange={value=>onAction('department',value,document.getElementById('appointment-department'))} note={`${APPOINTMENT_DEPARTMENTS.length}개 진료과 · 이름을 검색하거나 목록에서 선택해 주세요.`}/>;
}
