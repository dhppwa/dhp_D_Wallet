<?php
// --- กำหนดค่าเชื่อมต่อฐานข้อมูล ---
$host = "localhost";
$port = "5432"; // **แก้ไข**: ปกติ PostgreSQL จะใช้ Port 5432 (ส่วน 8080 มักจะเป็นพอร์ตของ Web Server)
$dbname = "your_database_name"; // อย่าลืมเปลี่ยนเป็นชื่อฐานข้อมูลจริงของคุณใน PostgreSQL
$user = "postgres";
$password = "your_password"; // ใส่รหัสผ่านของ postgres

try {
    // 1. เชื่อมต่อฐานข้อมูล PostgreSQL ผ่าน PDO
    $pdo = new PDO("pgsql:host=$host;port=$port;dbname=$dbname", $user, $password);
    
    // ตั้งค่าให้แจ้ง Error Alert ชัดเจนเมื่อมีคำสั่ง SQL ผิดพลาด
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    // 2. คำสั่ง SQL สำหรับสร้างตาราง Cafe_Amazon_Bill
    $sql = "CREATE TABLE IF NOT EXISTS Cafe_Amazon_Bill (
        ID SERIAL PRIMARY KEY,
        Bill_No VARCHAR(50),
        Cafe_Amazon_PK INT,
        Product_Type VARCHAR(13),
        ItemDetail TEXT,
        Price NUMERIC(10,2) DEFAULT 0.00,
        Discount NUMERIC(10,2) DEFAULT 0.00,
        Change NUMERIC(10,2) DEFAULT 0.00,
        InsertDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        IsUse BOOLEAN DEFAULT TRUE,
        Coupon_No VARCHAR(50)
    );";

    // 3. รันคำสั่ง SQL
    $pdo->exec($sql);
    echo "สร้างตาราง Cafe_Amazon_Bill สำเร็จเรียบร้อย!";

} catch (PDOException $e) {
    // แสดงข้อผิดพลาดหากเชื่อมต่อหรือรัน SQL ไม่ผ่าน
    echo "เกิดข้อผิดพลาดในการสร้างตาราง: " . $e->getMessage();
}
?>