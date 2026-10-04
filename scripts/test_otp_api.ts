async function testOtp() {
  console.log('Testing OTP Send API...');
  
  const sendRes = await fetch('http://localhost:3000/api/v2/auth/otp/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber: '9999999999' }),
  });
  
  const sendData: any = await sendRes.json();
  console.log('Send Response status:', sendRes.status, sendData);
  
  if (!sendData.success) {
    console.error('Send OTP failed!');
    return;
  }
  
  const requestId = sendData.requestId;
  console.log('Testing OTP Verify API with 123456 and requestId:', requestId);
  
  const verifyRes = await fetch('http://localhost:3000/api/v2/auth/otp/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phoneNumber: '9999999999',
      otp: '123456',
      requestId: requestId,
    }),
  });
  
  const verifyData: any = await verifyRes.json();
  console.log('Verify Response status:', verifyRes.status, verifyData);
  
  if (verifyData.success) {
    console.log('🎉 OTP SYSTEM IS WORKING FLAWLESSLY!');
  } else {
    console.error('Verify failed:', verifyData);
  }
}

testOtp().catch(console.error);
